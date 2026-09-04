#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createServer, type Server} from 'node:net';
import path from 'node:path';
import process from 'node:process';

import {logger} from '../logger.js';
import {
  Client,
  PipeTransport,
  StdioClientTransport,
} from '../third_party/index.js';
import {VERSION} from '../version.js';

import {getUptimeSeconds, redactDaemonArgs} from './status.js';
import {parseDaemonMessage} from './protocol.js';
import type {DaemonMessage} from './types.js';
import {
  DAEMON_CLIENT_NAME,
  getDaemonPid,
  getPidFilePath,
  getSocketPath,
  INDEX_SCRIPT_PATH,
  IS_WINDOWS,
  isDaemonRunning,
} from './utils.js';

const pid = getDaemonPid();
if (isDaemonRunning(pid)) {
  logger('Another daemon process is running.');
  process.exit(1);
}
const pidFilePath = getPidFilePath();
fs.mkdirSync(path.dirname(pidFilePath), {
  recursive: true,
});
fs.writeFileSync(pidFilePath, process.pid.toString());
logger(`Writing ${process.pid.toString()} to ${pidFilePath}`);

const socketPath = getSocketPath();

const startDate = new Date();
const mcpServerArgs = process.argv.slice(2);

let mcpClient: Client | null = null;
let mcpTransport: StdioClientTransport | null = null;
let server: Server | null = null;

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const IDLE_SHUTDOWN_WARNING_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;
let idleTimeout: NodeJS.Timeout | null = null;
let idleWarningTimeout: NodeJS.Timeout | null = null;
let activeRequestCount = 0;

function clearIdleTimeout() {
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }
  if (idleWarningTimeout) {
    clearTimeout(idleWarningTimeout);
    idleWarningTimeout = null;
  }
}

function playIdleShutdownWarning(): void {
  let command: string;
  let args: string[];

  if (IS_WINDOWS) {
    command = 'powershell.exe';
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::Beep(880, 300)',
    ];
  } else if (process.platform === 'darwin') {
    command = 'afplay';
    args = ['/System/Library/Sounds/Glass.aiff'];
  } else {
    command = 'sh';
    args = [
      '-c',
      [
        'if command -v paplay >/dev/null 2>&1 && [ -f /usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga ]; then',
        '  paplay /usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga;',
        'elif command -v aplay >/dev/null 2>&1 && [ -f /usr/share/sounds/alsa/Front_Left.wav ]; then',
        '  aplay -q /usr/share/sounds/alsa/Front_Left.wav;',
        'elif command -v beep >/dev/null 2>&1; then',
        '  beep -f 880 -l 300;',
        'fi',
      ].join(' '),
    ];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', error => {
      logger('Unable to play idle shutdown warning:', error);
    });
    child.unref();
  } catch (error) {
    // Audio is best-effort and must never prevent daemon shutdown.
    logger('Unable to start idle shutdown warning:', error);
  }
}

function warnBeforeIdleShutdown(): void {
  logger('Daemon will shut down in 5 seconds due to inactivity.');
  console.log('Daemon will shut down in 5 seconds due to inactivity.');
  playIdleShutdownWarning();
}

function resetIdleTimeout() {
  clearIdleTimeout();
  idleWarningTimeout = setTimeout(
    warnBeforeIdleShutdown,
    IDLE_TIMEOUT_MS - IDLE_SHUTDOWN_WARNING_MS,
  );
  idleTimeout = setTimeout(() => {
    logger('Idle timeout reached. Shutting down daemon.');
    console.log('Daemon shutting down due to inactivity.');
    void cleanup();
  }, IDLE_TIMEOUT_MS);
}

async function setupMCPClient() {
  console.log('Setting up MCP client connection...');

  // Create stdio transport for chrome-devtools-mcp
  mcpTransport = new StdioClientTransport({
    command: process.execPath,
    args: [INDEX_SCRIPT_PATH, ...mcpServerArgs],
    env: process.env as Record<string, string>,
  });
  mcpClient = new Client(
    {
      name: DAEMON_CLIENT_NAME,
      version: VERSION,
    },
    {
      capabilities: {},
    },
  );
  await mcpClient.connect(mcpTransport);

  console.log('MCP client connected');
}

interface McpContent {
  type: string;
  text?: string;
}

interface McpResult {
  content?: McpContent[] | string;
  text?: string;
}
async function handleRequest(msg: DaemonMessage) {
  activeRequestCount++;
  clearIdleTimeout();
  try {
    if (msg.method === 'invoke_tool') {
      if (!mcpClient) {
        throw new Error('MCP client not initialized');
      }
      const {tool, args, timeoutMs} = msg;

      if (
        timeoutMs !== undefined &&
        (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      ) {
        throw new Error('MCP request timeout must be a non-negative number');
      }

      const requestTimeout =
        timeoutMs === 0 ? MAX_REQUEST_TIMEOUT_MS : timeoutMs;

      const result = (await mcpClient.callTool(
        {
          name: tool,
          arguments: args || {},
        },
        undefined,
        requestTimeout === undefined ? undefined : {timeout: requestTimeout},
      )) as McpResult | McpContent[];

      return {
        success: true,
        result: JSON.stringify(result),
      };
    } else if (msg.method === 'stop') {
      // Ensure we are not interrupting in-progress starting.
      await started;
      // Trigger cleanup asynchronously.
      setImmediate(() => {
        void cleanup();
      });
      return {
        success: true,
        message: 'stopping',
      };
    } else if (msg.method === 'status') {
      await started;

      let mcpConnected = false;
      if (mcpClient) {
        try {
          await mcpClient.ping({timeout: 2_000});
          mcpConnected = true;
        } catch (error) {
          logger('MCP health check failed:', error);
        }
      }

      const daemonReady = server?.listening === true;
      return {
        success: true,
        result: JSON.stringify({
          running: true,
          healthy: daemonReady && mcpConnected,
          pid: process.pid,
          socketPath,
          startDate: startDate.toISOString(),
          uptimeSeconds: getUptimeSeconds(startDate.toISOString()),
          version: VERSION,
          args: redactDaemonArgs(mcpServerArgs),
          health: {
            daemonReady,
            mcpConnected,
            // Browser initialization is lazy and is not triggered by status.
            browserConnected: null,
          },
        }),
      };
    }
    {
      return {
        success: false,
        error: `Unknown method: ${JSON.stringify(msg, null, 2)}`,
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    activeRequestCount--;
    if (activeRequestCount === 0 && msg.method !== 'stop') {
      resetIdleTimeout();
    }
  }
}

async function startSocketServer() {
  // Remove existing socket file if it exists (only on non-Windows)
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore errors.
    }
  }

  return await new Promise<void>((resolve, reject) => {
    server = createServer(socket => {
      const transport = new PipeTransport(socket, socket);
      transport.onmessage = async (message: string) => {
        logger('onmessage', message);
        let response;
        try {
          response = await handleRequest(parseDaemonMessage(message));
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Invalid daemon request.';
          response = {
            success: false,
            error: errorMessage,
          };
        }
        transport.send(JSON.stringify(response));
        socket.end();
      };
      socket.on('error', error => {
        logger('Socket error:', error);
      });
    });

    server.listen(
      {
        path: socketPath,
        readableAll: false,
        writableAll: false,
      },
      async () => {
        console.log(`Daemon server listening on ${socketPath}`);

        try {
          // Setup MCP client
          await setupMCPClient();
          resetIdleTimeout(); // Start the idle timer
          resolve();
        } catch (err) {
          reject(err);
        }
      },
    );

    server.on('error', error => {
      logger('Server error:', error);
      reject(error);
    });
  });
}

async function cleanup() {
  console.log('Cleaning up daemon...');

  clearIdleTimeout();

  try {
    await mcpClient?.close();
  } catch (error) {
    logger('Error closing MCP client:', error);
  }
  try {
    await mcpTransport?.close();
  } catch (error) {
    logger('Error closing MCP transport:', error);
  }
  if (server) {
    await new Promise<void>(resolve => {
      server!.close(() => resolve());
    });
  }
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore errors
    }
  }
  logger(`unlinking ${pidFilePath}`);
  if (fs.existsSync(pidFilePath)) {
    fs.unlinkSync(pidFilePath);
  }
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => {
  void cleanup();
});
process.on('SIGINT', () => {
  void cleanup();
});
process.on('SIGHUP', () => {
  void cleanup();
});

// Handle uncaught errors
process.on('uncaughtException', error => {
  logger('Uncaught exception:', error);
});
process.on('unhandledRejection', error => {
  logger('Unhandled rejection:', error);
});

// Start the server
const started = startSocketServer().catch(error => {
  logger('Failed to start daemon server:', error);
  process.exit(1);
});
