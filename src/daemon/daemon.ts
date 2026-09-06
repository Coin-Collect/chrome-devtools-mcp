#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {spawn} from 'node:child_process';
import {randomBytes, timingSafeEqual} from 'node:crypto';
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

import {parseDaemonMessage, summarizeDaemonMessage} from './protocol.js';
import {getUptimeSeconds, redactDaemonArgs} from './status.js';
import type {DaemonMessage} from './types.js';
import {
  DAEMON_CLIENT_NAME,
  getDaemonPid,
  getDaemonTokenPath,
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
const daemonTokenPath = getDaemonTokenPath();
const runtimeDirectory = path.dirname(pidFilePath);
fs.mkdirSync(runtimeDirectory, {
  recursive: true,
  mode: 0o700,
});
if (!IS_WINDOWS) {
  const runtimeStats = fs.statSync(runtimeDirectory);
  if ((runtimeStats.mode & 0o077) !== 0) {
    fs.chmodSync(runtimeDirectory, 0o700);
  }
}
const pidFileDescriptor = fs.openSync(
  pidFilePath,
  fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (fs.constants.O_NOFOLLOW ?? 0),
  0o600,
);
try {
  fs.writeFileSync(pidFileDescriptor, process.pid.toString(), {encoding: 'utf8'});
  try {
    fs.fchmodSync(pidFileDescriptor, 0o600);
  } catch {
    // Windows ACLs are inherited from the per-user runtime directory.
  }
} finally {
  fs.closeSync(pidFileDescriptor);
}
logger(`Writing ${process.pid.toString()} to ${pidFilePath}`);

function createDaemonAuthToken(): string {
  const token = randomBytes(32).toString('hex');
  try {
    const existing = fs.lstatSync(daemonTokenPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`Refusing to use unsafe daemon token path: ${daemonTokenPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(
    daemonTokenPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow,
    0o600,
  );
  try {
    fs.writeFileSync(fd, token, {encoding: 'utf8'});
    try {
      fs.fchmodSync(fd, 0o600);
    } catch {
      // Windows ACLs are inherited from the per-user runtime directory.
    }
  } finally {
    fs.closeSync(fd);
  }
  return token;
}

const daemonAuthToken = createDaemonAuthToken();

const socketPath = getSocketPath();

const startDate = new Date();
const mcpServerArgs = process.argv.slice(2);

let mcpClient: Client | null = null;
let mcpTransport: StdioClientTransport | null = null;
let server: Server | null = null;

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const IDLE_SHUTDOWN_WARNING_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;
const MAX_DAEMON_MESSAGE_BYTES = 1024 * 1024;
const DAEMON_HANDSHAKE_TIMEOUT_MS = 30_000;
const MAX_DAEMON_CONNECTIONS = 16;
let idleTimeout: NodeJS.Timeout | null = null;
let idleWarningTimeout: NodeJS.Timeout | null = null;
let activeRequestCount = 0;
let activeConnectionCount = 0;

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
        (!Number.isFinite(timeoutMs) ||
          timeoutMs < 0 ||
          timeoutMs > MAX_REQUEST_TIMEOUT_MS)
      ) {
        throw new Error(
          'MCP request timeout must be between 0 and the supported maximum',
        );
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
      if (activeConnectionCount >= MAX_DAEMON_CONNECTIONS) {
        socket.destroy();
        return;
      }
      activeConnectionCount++;
      let receivedBytes = 0;
      let requestReceived = false;
      let oversized = false;
      const handshakeTimer = setTimeout(() => {
        socket.destroy(new Error('Daemon request handshake timed out.'));
      }, DAEMON_HANDSHAKE_TIMEOUT_MS);
      const releaseConnection = () => {
        clearTimeout(handshakeTimer);
        activeConnectionCount--;
      };
      socket.once('close', releaseConnection);
      socket.on('data', (chunk: Buffer) => {
        if (requestReceived) {
          return;
        }
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_DAEMON_MESSAGE_BYTES) {
          oversized = true;
          socket.destroy(new Error('Daemon request exceeds the size limit.'));
        }
      });

      const transport = new PipeTransport(socket, socket);
      transport.onmessage = async (message: string) => {
        if (oversized || requestReceived) {
          return;
        }
        requestReceived = true;
        clearTimeout(handshakeTimer);
        socket.pause();
        let parsedMessage: DaemonMessage;
        let response;
        try {
          parsedMessage = parseDaemonMessage(message);
          const providedToken = Buffer.from(parsedMessage.authToken ?? '');
          const expectedToken = Buffer.from(daemonAuthToken);
          if (
            providedToken.length !== expectedToken.length ||
            !timingSafeEqual(providedToken, expectedToken)
          ) {
            throw new Error('Unauthorized daemon request.');
          }
          logger('onmessage', summarizeDaemonMessage(parsedMessage));
          response = await handleRequest(parsedMessage);
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
  try {
    fs.unlinkSync(daemonTokenPath);
  } catch {
    // ignore errors
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
