/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DaemonHealth {
  daemonReady: boolean;
  mcpConnected: boolean;
  // Browser initialization is lazy, so null means it has not been checked.
  browserConnected: boolean | null;
}

export interface DaemonStatus {
  running: boolean;
  healthy: boolean;
  pid: number | null;
  socketPath: string;
  startDate: string;
  uptimeSeconds: number | null;
  version: string;
  args: string[];
  health: DaemonHealth;
}

export function normalizeDaemonStatus(value: unknown): DaemonStatus {
  const data = (value ?? {}) as Partial<DaemonStatus>;
  const health = (data.health ?? {}) as Partial<DaemonHealth>;

  return {
    running: data.running ?? true,
    healthy: data.healthy ?? true,
    pid: typeof data.pid === 'number' ? data.pid : null,
    socketPath: typeof data.socketPath === 'string' ? data.socketPath : '',
    startDate: typeof data.startDate === 'string' ? data.startDate : '',
    uptimeSeconds:
      typeof data.uptimeSeconds === 'number' ? data.uptimeSeconds : null,
    version: typeof data.version === 'string' ? data.version : '',
    args: redactDaemonArgs(
      Array.isArray(data.args) ? data.args.map(String) : [],
    ),
    health: {
      daemonReady: health.daemonReady ?? true,
      mcpConnected: health.mcpConnected ?? true,
      browserConnected: health.browserConnected ?? null,
    },
  };
}

const SENSITIVE_FLAGS = new Set([
  '--browser-url',
  '--chrome-arg',
  '--executable-path',
  '--log-file',
  '--proxy-server',
  '--user-data-dir',
  '--ws-endpoint',
  '--ws-headers',
]);

function getFlagName(arg: string): string {
  const separatorIndex = arg.indexOf('=');
  return (
    separatorIndex === -1 ? arg : arg.slice(0, separatorIndex)
  ).toLowerCase();
}

function isSensitiveFlag(arg: string): boolean {
  const flagName = getFlagName(arg);
  return (
    SENSITIVE_FLAGS.has(flagName) ||
    /(?:key|token|secret|password|passwd|auth|credential|header)/i.test(
      flagName,
    )
  );
}

export function redactDaemonArgs(args: string[]): string[] {
  const redactedArgs: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      if (!arg.startsWith('-')) {
        redactedArgs.push('<redacted>');
        redactNext = false;
        continue;
      }
      redactNext = false;
    }

    if (isSensitiveFlag(arg)) {
      const separatorIndex = arg.indexOf('=');
      if (separatorIndex === -1) {
        redactedArgs.push(arg);
        redactNext = true;
      } else {
        redactedArgs.push(`${arg.slice(0, separatorIndex)}=<redacted>`);
      }
      continue;
    }

    redactedArgs.push(arg);
  }

  return redactedArgs;
}

export function getUptimeSeconds(
  startDate: string,
  now = Date.now(),
): number | null {
  const startTime = Date.parse(startDate);
  if (Number.isNaN(startTime)) {
    return null;
  }
  return Math.max(0, Math.floor((now - startTime) / 1000));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return 'unknown';
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || parts.length > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || parts.length > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${remainingSeconds}s`);
  return parts.join(' ');
}

export function formatDaemonStatus(
  status: DaemonStatus,
  format: 'md' | 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(status);
  }

  if (!status.running) {
    return [
      '',
      '============================================================',
      '                 DAEMON NOT RUNNING',
      '============================================================',
      'Start the daemon with `rockstar start` or `chrome-devtools start`.',
      '',
    ].join('\n');
  }

  const browserStatus =
    status.health.browserConnected === null
      ? 'not checked (initialized lazily)'
      : status.health.browserConnected
        ? 'connected'
        : 'disconnected';

  return [
    `Status: ${status.running ? 'running' : 'not running'}`,
    `Health: ${status.healthy ? 'healthy' : 'unhealthy'}`,
    `Daemon: ${status.health.daemonReady ? 'ready' : 'not ready'}`,
    `MCP: ${status.health.mcpConnected ? 'connected' : 'disconnected'}`,
    `Browser: ${browserStatus}`,
    `PID: ${status.pid ?? 'unknown'}`,
    `Socket: ${status.socketPath || 'unknown'}`,
    `Start date: ${status.startDate || 'unknown'}`,
    `Uptime: ${formatDuration(status.uptimeSeconds)}`,
    `Version: ${status.version || 'unknown'}`,
    `Args: ${JSON.stringify(status.args)}`,
  ].join('\n');
}

export function createUnavailableDaemonStatus(): DaemonStatus {
  return {
    running: false,
    healthy: false,
    pid: null,
    socketPath: '',
    startDate: '',
    uptimeSeconds: null,
    version: '',
    args: [],
    health: {
      daemonReady: false,
      mcpConnected: false,
      browserConnected: false,
    },
  };
}
