/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {copyRockstarSkillToAgents} from '../../src/bin/rockstarxSkill.js';

describe('Rockstar CLI skill installer', () => {
  it('copies the skill from rockstarx to the current workspace agents directory', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rockstar-skill-'));
    const homeDir = path.join(tempRoot, 'home');
    const cwd = path.join(tempRoot, 'workspace');
    const source = path.join(homeDir, 'rockstarx', 'skills', 'rockstar-cli');
    const sourceFile = path.join(source, 'SKILL.md');

    try {
      fs.mkdirSync(source, {recursive: true});
      fs.writeFileSync(sourceFile, 'test skill', 'utf8');

      const destination = copyRockstarSkillToAgents(cwd, homeDir);

      assert.strictEqual(
        destination,
        path.join(cwd, '.agents', 'skills', 'rockstar-cli'),
      );
      assert.strictEqual(
        fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8'),
        'test skill',
      );
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true});
    }
  });
});
