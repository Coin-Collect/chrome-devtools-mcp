/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {it} from 'node:test';

import type {ParsedArguments} from '../../src/bin/chrome-devtools-mcp-cli-options.js';
import {createTools} from '../../src/tools/tools.js';

it('registers list_pages in the active tool set', () => {
  const toolNames = createTools({} as ParsedArguments).map(tool => tool.name);
  assert.ok(toolNames.includes('list_pages'));
});
