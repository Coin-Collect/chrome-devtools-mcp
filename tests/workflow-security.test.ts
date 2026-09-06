/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {it} from 'node:test';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

import type {Page} from '../src/third_party/index.js';
import type {
  Context,
  ContextPage,
  Response,
} from '../src/tools/ToolDefinition.js';

const execFileAsync = promisify(execFile);

it('daemon-free list_workflows preserves untrusted boundaries and JSON trust metadata', async () => {
  const cli = path.join(import.meta.dirname, '../src/bin/rockstar-x.js');
  const fixture = path.join(
    import.meta.dirname,
    'fixtures/workflow-list-fetch.js',
  );
  for (const format of ['md', 'json']) {
    const {stdout} = await execFileAsync(
      process.execPath,
      [
        '--import',
        pathToFileURL(fixture).href,
        cli,
        'list_workflows',
        '--show_steps',
        '--output-format',
        format,
      ],
      {timeout: 20000, windowsHide: true},
    );
    if (format === 'md') {
      assert(stdout.includes('&lt;/untrusted-page-content&gt;'));
      const boundaries = (stdout.match(/<untrusted-page-content>/g) ?? [])
        .length;
      assert(boundaries > 0);
      assert.equal(
        (stdout.match(/<\/untrusted-page-content>/g) ?? []).length,
        boundaries,
      );
      assert(stdout.includes('Selector: #submit'));
    } else {
      const output = JSON.parse(stdout);
      assert.equal(output.pageContentTrust.trusted, false);
      assert.deepEqual(output.pageContentTrust.sources, ['workflow metadata']);
      assert.equal(output.workflows.length, 1);
    }
  }
});

it('selector search propagates a targeted frame whitelist violation without falling back', async () => {
  process.env.SUPABASE_URL = 'https://workflow-tests.invalid';
  process.env.SUPABASE_KEY = 'synthetic-test-key';
  const {findElementBySelectors} = await import('../src/tools/workflow.js');
  let fallbackUsed = false;
  const frame = {url: () => 'file:///blocked', parentFrame: () => null};
  const page = {
    mainFrame: () => frame,
    frames: () => {
      fallbackUsed = true;
      return [];
    },
  } as unknown as Page;
  await assert.rejects(
    findElementBySelectors(page, {
      best_selector: '#target',
      strategies: [],
      ax_node_meta: {role: '', name: '', description: ''},
    }),
    /Security Violation/,
  );
  assert.equal(fallbackUsed, false);
  const stalePage = {
    mainFrame: () => {
      throw new Error('Stale frame');
    },
    frames: () => [frame],
  } as unknown as Page;
  await assert.rejects(
    findElementBySelectors(stalePage, {
      best_selector: '#target',
      strategies: [],
      ax_node_meta: {role: '', name: '', description: ''},
    }),
    /Security Violation/,
  );
});

it('UID-less typing and coordinate clicks reject forbidden pages before input', async () => {
  process.env.SUPABASE_URL = 'https://workflow-tests.invalid';
  process.env.SUPABASE_KEY = 'synthetic-test-key';
  const {typeLikeHuman, clickAtLikeHuman} =
    await import('../src/tools/workflow.js');
  let inputEvents = 0;
  const input = async () => {
    inputEvents++;
  };
  const page = {
    pptrPage: {
      evaluate: async () => undefined,
      keyboard: {down: input, up: input},
      mouse: {down: input, up: input, move: input},
      createCDPSession: async () => ({
        send: async () => ({
          frameTree: {
            frame: {
              id: 'main',
              url: 'file:///blocked',
              securityOrigin: 'file://',
            },
          },
        }),
        detach: async () => undefined,
      }),
    },
  } as unknown as ContextPage;
  await assert.rejects(
    typeLikeHuman.handler(
      {page, params: {text: 'sensitive value'}},
      {} as Response,
      {} as Context,
    ),
    /Security Violation/,
  );
  await assert.rejects(
    clickAtLikeHuman.handler(
      {page, params: {x: 1, y: 1}},
      {} as Response,
      {} as Context,
    ),
    /Security Violation/,
  );
  assert.equal(inputEvents, 0);
});
