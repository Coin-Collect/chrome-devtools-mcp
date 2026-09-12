/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  findElementBySelectors,
  generateSelectorsForElement,
} from '../../src/tools/workflow.js';
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

  it('falls back to xpath when no CSS-compatible frame selector exists', () => {
    const selector = pickBestFrameSelector([
      {type: 'xpath', value: '//iframe[1]', priority: 10},
    ]);

    assert.strictEqual(selector, '//iframe[1]');
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

  it('keeps broad selector strategies for runtime signature matching', async () => {
    await withMcpContext(async (_response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(html`
        <button name="day">10</button>
        <button id="target" name="day">11</button>
      `);

      const target = await page.$('#target');
      assert(target);
      const strategies = await generateSelectorsForElement(target);
      await target.dispose();

      assert(
        strategies.some(
          strategy =>
            strategy.type === 'name' && strategy.value === '[name="day"]',
        ),
      );
    });
  });

  it('narrows a non-unique selector using the recorded target signature', async () => {
    await withMcpContext(async (_response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(html`
        <button name="day" role="gridcell">10</button>
        <button name="day" role="gridcell">11</button>
      `);

      const result = await findElementBySelectors(page, {
        best_selector: '[name="day"]',
        strategies: [
          {type: 'name', value: '[name="day"]', priority: 4},
        ],
        ax_node_meta: {role: 'gridcell', name: '11', description: ''},
        target_signature: {
          tag_name: 'button',
          id: '',
          role: 'gridcell',
          aria_label: '',
          name: 'day',
          type: '',
          placeholder: '',
          test_id: '',
          title: '',
          href: '',
          text: '11',
        },
      });

      assert(result);
      assert.strictEqual(await result.element.evaluate(element => element.textContent), '11');
      await result.element.dispose();
    });
  });

  it('falls back to the target signature when persisted selectors are stale', async () => {
    await withMcpContext(async (_response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(html`
        <button name="day" role="gridcell">10</button>
        <button name="day" role="gridcell">11</button>
      `);

      const result = await findElementBySelectors(page, {
        best_selector: '//button[1]',
        strategies: [
          {type: 'xpath', value: '//button[1]', priority: 10},
        ],
        ax_node_meta: {role: '', name: '', description: ''},
        target_signature: {
          tag_name: 'button',
          id: '',
          role: 'gridcell',
          aria_label: '',
          name: 'day',
          type: '',
          placeholder: '',
          test_id: '',
          title: '',
          href: '',
          text: '11',
        },
      });

      assert(result);
      assert.strictEqual(result.usedStrategy.type, 'target-signature');
      assert.strictEqual(await result.element.evaluate(element => element.textContent), '11');
      await result.element.dispose();
    });
  });
});
