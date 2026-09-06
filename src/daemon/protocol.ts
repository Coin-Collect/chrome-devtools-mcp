/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DaemonMessage} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every(key => allowedKeys.includes(key));
}

const MAX_DAEMON_AUTH_TOKEN_LENGTH = 256;
const MAX_DAEMON_TIMEOUT_MS = 2_147_483_647;

export function summarizeDaemonMessage(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {invalid: true};
  }

  const summary: Record<string, unknown> = {
    method: typeof value.method === 'string' ? value.method : '<invalid>',
  };
  if (typeof value.tool === 'string') {
    summary.tool = value.tool;
  }
  if (typeof value.timeoutMs === 'number') {
    summary.timeoutMs = value.timeoutMs;
  }
  if (value.args !== undefined) {
    summary.args = '<redacted>';
  }
  return summary;
}

export function validateDaemonMessage(value: unknown): DaemonMessage {
  if (!isRecord(value) || typeof value.method !== 'string') {
    throw new Error(
      'Invalid daemon request: expected an object with a method.',
    );
  }

  if (value.method === 'stop' || value.method === 'status') {
    if (!hasOnlyKeys(value, ['method', 'authToken'])) {
      throw new Error(
        `Invalid daemon request: ${value.method} does not accept arguments.`,
      );
    }
    if (
      typeof value.authToken !== 'string' ||
      value.authToken.length === 0 ||
      value.authToken.length > MAX_DAEMON_AUTH_TOKEN_LENGTH
    ) {
      throw new Error('Invalid daemon request: authToken must be provided.');
    }
    return {method: value.method, authToken: value.authToken};
  }

  if (value.method !== 'invoke_tool') {
    throw new Error('Invalid daemon request: unsupported method.');
  }

  if (!hasOnlyKeys(value, ['method', 'authToken', 'tool', 'args', 'timeoutMs'])) {
    throw new Error('Invalid daemon request: unsupported invoke_tool fields.');
  }

  if (typeof value.tool !== 'string' || value.tool.trim().length === 0) {
    throw new Error('Invalid daemon request: tool must be a non-empty string.');
  }

  if (
    typeof value.authToken !== 'string' ||
    value.authToken.length === 0 ||
    value.authToken.length > MAX_DAEMON_AUTH_TOKEN_LENGTH
  ) {
    throw new Error('Invalid daemon request: authToken must be provided.');
  }

  if (value.args !== undefined && !isRecord(value.args)) {
    throw new Error('Invalid daemon request: args must be an object.');
  }

  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== 'number' ||
      !Number.isFinite(value.timeoutMs) ||
      value.timeoutMs < 0 ||
      value.timeoutMs > MAX_DAEMON_TIMEOUT_MS)
  ) {
    throw new Error(
      'Invalid daemon request: timeoutMs must be between 0 and the supported maximum.',
    );
  }

  return {
    method: 'invoke_tool',
    authToken: value.authToken,
    tool: value.tool,
    ...(value.args === undefined ? {} : {args: value.args}),
    ...(value.timeoutMs === undefined ? {} : {timeoutMs: value.timeoutMs}),
  };
}

export function parseDaemonMessage(payload: string): DaemonMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Invalid daemon request: malformed JSON.');
  }
  return validateDaemonMessage(parsed);
}
