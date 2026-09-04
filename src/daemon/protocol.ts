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

export function validateDaemonMessage(value: unknown): DaemonMessage {
  if (!isRecord(value) || typeof value.method !== 'string') {
    throw new Error(
      'Invalid daemon request: expected an object with a method.',
    );
  }

  if (value.method === 'stop' || value.method === 'status') {
    if (!hasOnlyKeys(value, ['method'])) {
      throw new Error(
        `Invalid daemon request: ${value.method} does not accept arguments.`,
      );
    }
    return {method: value.method};
  }

  if (value.method !== 'invoke_tool') {
    throw new Error('Invalid daemon request: unsupported method.');
  }

  if (!hasOnlyKeys(value, ['method', 'tool', 'args', 'timeoutMs'])) {
    throw new Error('Invalid daemon request: unsupported invoke_tool fields.');
  }

  if (typeof value.tool !== 'string' || value.tool.trim().length === 0) {
    throw new Error('Invalid daemon request: tool must be a non-empty string.');
  }

  if (value.args !== undefined && !isRecord(value.args)) {
    throw new Error('Invalid daemon request: args must be an object.');
  }

  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== 'number' ||
      !Number.isFinite(value.timeoutMs) ||
      value.timeoutMs < 0)
  ) {
    throw new Error(
      'Invalid daemon request: timeoutMs must be a non-negative number.',
    );
  }

  return {
    method: 'invoke_tool',
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
