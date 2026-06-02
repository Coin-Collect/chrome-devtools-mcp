/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {pickBestFrameSelector, resolveFrame} from '../../src/tools/workflowSelectors.js';
import {html, withMcpContext} from '../utils.js';

describe('workflow selector helpers', () => {
  it('prefers a CSS-compatible frame selector over xpath', () => {
    const selector = pickBestFrameSelector([
      {type: 'xpath', value: '//iframe[1]', priority: 10},
      {type: 'css-path', value: 'body > iframe:nth-of-type(1)', priority: 11},
    ]);

    assert.strictEqual(selector, 'body > iframe:nth-of-type(1)');
  });

  it('resolves iframe selectors stored as xpath', async () => {
    await withMcpContext(async (_response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(
        html`<main>
          <iframe srcdoc="<button id='inside'>Inside iframe</button>"></iframe>
        </main>`,
      );

      const frame = await resolveFrame(page, ['//iframe']);
      assert.notStrictEqual(frame, page.mainFrame());

      const buttonText = await frame.evaluate(
        () => document.querySelector('button')?.textContent ?? '',
      );
      assert.strictEqual(buttonText, 'Inside iframe');
    });
  });
});
