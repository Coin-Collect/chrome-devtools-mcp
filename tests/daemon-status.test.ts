/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  createUnavailableDaemonStatus,
  formatDaemonStatus,
  getUptimeSeconds,
  normalizeDaemonStatus,
  redactDaemonArgs,
} from '../src/daemon/status.js';

describe('daemon status helpers', () => {
  it('redacts sensitive argument values', () => {
    const args = redactDaemonArgs([
      '--browser-url',
      'https://user:password@example.test',
      '--headless',
      '--token=secret-token',
      '--ws-headers',
      '{"Authorization":"Bearer secret"}',
    ]);

    assert.deepStrictEqual(args, [
      '--browser-url',
      '<redacted>',
      '--headless',
      '--token=<redacted>',
      '--ws-headers',
      '<redacted>',
    ]);
  });

  it('calculates uptime in whole seconds', () => {
    const startDate = '2026-08-29T10:00:00.000Z';
    const now = Date.parse(startDate) + 3_661_000;

    assert.strictEqual(getUptimeSeconds(startDate, now), 3_661);
    assert.strictEqual(getUptimeSeconds('not-a-date', now), null);
  });

  it('normalizes legacy daemon status responses', () => {
    const status = normalizeDaemonStatus({
      pid: 123,
      socketPath: 'socket',
      startDate: '2026-08-29T10:00:00.000Z',
      version: '0.21.0',
      args: ['--ws-endpoint', 'wss://secret.example'],
    });

    assert.strictEqual(status.running, true);
    assert.strictEqual(status.healthy, true);
    assert.deepStrictEqual(status.args, ['--ws-endpoint', '<redacted>']);
    assert.deepStrictEqual(status.health, {
      daemonReady: true,
      mcpConnected: true,
      browserConnected: null,
    });
  });

  it('formats unavailable status as JSON', () => {
    const status = createUnavailableDaemonStatus();
    assert.deepStrictEqual(
      JSON.parse(formatDaemonStatus(status, 'json')),
      status,
    );
  });
});
