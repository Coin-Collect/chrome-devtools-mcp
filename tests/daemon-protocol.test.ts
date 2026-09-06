/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  parseDaemonMessage,
  summarizeDaemonMessage,
} from '../src/daemon/protocol.js';

describe('daemon request protocol', () => {
  it('accepts only well-formed daemon requests', () => {
    assert.deepStrictEqual(
      parseDaemonMessage(
        JSON.stringify({
          method: 'invoke_tool',
          authToken: 'a'.repeat(64),
          tool: 'run_workflow',
          args: {workflow_id: 1},
          timeoutMs: 0,
        }),
      ),
      {
        method: 'invoke_tool',
        authToken: 'a'.repeat(64),
        tool: 'run_workflow',
        args: {workflow_id: 1},
        timeoutMs: 0,
      },
    );
  });

  it('rejects malformed daemon payloads before tool execution', () => {
    for (const payload of [
      '{',
      'null',
      '[]',
      JSON.stringify({method: 'unknown'}),
      JSON.stringify({method: 'stop', authToken: 'a'.repeat(64), args: {unexpected: true}}),
      JSON.stringify({method: 'invoke_tool', authToken: 'a'.repeat(64), tool: ''}),
      JSON.stringify({method: 'invoke_tool', authToken: 'a'.repeat(64), tool: 'run_workflow', args: []}),
      JSON.stringify({
        method: 'invoke_tool',
        authToken: 'a'.repeat(64),
        tool: 'run_workflow',
        timeoutMs: -1,
      }),
      JSON.stringify({
        method: 'invoke_tool',
        authToken: 'a'.repeat(64),
        tool: 'run_workflow',
        timeoutMs: 2_147_483_648,
      }),
      JSON.stringify({
        method: 'invoke_tool',
        authToken: 'a'.repeat(64),
        tool: 'run_workflow',
        extra: true,
      }),
      JSON.stringify({method: 'status'}),
    ]) {
      assert.throws(
        () => parseDaemonMessage(payload),
        /Invalid daemon request/,
      );
    }
  });

  it('summarizes requests without exposing tool arguments or tokens', () => {
    assert.deepStrictEqual(
      summarizeDaemonMessage({
        method: 'invoke_tool',
        authToken: 'secret-token',
        tool: 'run_workflow',
        args: {password: 'do-not-log'},
      }),
      {method: 'invoke_tool', tool: 'run_workflow', args: '<redacted>'},
    );
  });
});
