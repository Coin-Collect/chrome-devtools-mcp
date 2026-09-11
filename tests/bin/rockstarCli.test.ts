/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {describe, it} from 'node:test';

const cliPath = fileURLToPath(
  new URL('../../src/bin/rockstar-x.js', import.meta.url),
);

describe('Rockstar CLI help command', () => {
  for (const argument of ['help', '--help']) {
    it(`writes ${argument} output to stdout before exiting`, () => {
      const result = spawnSync(process.execPath, [cliPath, argument], {
        encoding: 'utf8',
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /Rockstar CLI/);
      assert.match(result.stdout, /Workflow execution:/);
      assert.equal(result.stderr, '');
    });
  }
});
