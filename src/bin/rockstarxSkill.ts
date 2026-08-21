/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function copyRockstarSkillToAgents(
  cwd = process.cwd(),
  homeDir = os.homedir(),
): string {
  const source = path.join(homeDir, 'rockstarx', 'skills', 'rockstar-cli');
  const destination = path.join(cwd, '.agents', 'skills', 'rockstar-cli');

  if (!fs.existsSync(source)) {
    throw new Error(`Rockstar CLI skill was not found at ${source}`);
  }

  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.cpSync(source, destination, {recursive: true, force: true});
  return destination;
}
