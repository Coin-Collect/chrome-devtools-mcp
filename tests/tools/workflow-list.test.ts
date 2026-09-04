/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  createWorkflowListPage,
  escapeLikePattern,
  formatWorkflowListLines,
  normalizeWebsiteHostname,
  normalizeWorkflowRows,
  sortWorkflowItems,
  summarizeWorkflowList,
  workflowMatchesHostname,
} from '../../src/tools/workflowList.js';

describe('workflow list helpers', () => {
  it('normalizes malformed rows and preserves selector details safely', () => {
    const rows = [
      {
        id: 2,
        title: '  Beta\nFlow  ',
        status: 'draft',
        website_url: 'https://app.example.com/login',
        description: 'Description\nwith a newline',
        success_criteria: null,
        created_at: '2026-01-02T00:00:00.000Z',
        workflow_steps: [
          {
            id: 20,
            step_order: 2,
            action: 'click',
            action_value: null,
            description: null,
            selectors: {
              best_selector: '#submit',
              strategies: [{type: 'css', value: '#submit', priority: 1}],
              frame_selectors: ['iframe.login'],
              target_signature: {tag_name: 'button'},
            },
          },
          {
            id: 19,
            step_order: 1,
            action: 'choice_click',
            action_value: '{{plan}}',
            description: 'Choose a plan',
            selectors: {
              choices: {
                basic: {
                  best_selector: '[data-plan="basic"]',
                  strategies: [],
                },
              },
            },
          },
          {step_order: 'invalid', action: 'ignored'},
        ],
      },
      {title: 'Missing ID'},
      null,
    ];

    const workflows = normalizeWorkflowRows(rows, {
      showSteps: true,
      showSelectorStrategies: true,
      maxSteps: 1,
    });

    assert.strictEqual(workflows.length, 1);
    assert.strictEqual(workflows[0].title, 'Beta Flow');
    assert.strictEqual(workflows[0].description, 'Description with a newline');
    assert.strictEqual(workflows[0].step_count, 2);
    assert.strictEqual(workflows[0].steps?.length, 1);
    assert.strictEqual(workflows[0].steps_truncated, true);
    assert.strictEqual(workflows[0].steps?.[0].action, 'choice_click');
    assert.strictEqual(
      workflows[0].steps?.[0].selectors &&
        'choices' in workflows[0].steps[0].selectors
        ? workflows[0].steps[0].selectors.choices.basic.best_selector
        : undefined,
      '[data-plan="basic"]',
    );
  });

  it('sorts deterministically without mutating the input', () => {
    const workflows = normalizeWorkflowRows(
      [
        {id: 2, title: 'Same', status: 'draft', created_at: '2026-01-01'},
        {id: 1, title: 'Same', status: 'draft', created_at: '2026-01-01'},
      ],
      {showSteps: false, showSelectorStrategies: false},
    );

    const sorted = sortWorkflowItems(workflows, 'title', 'asc');
    assert.deepStrictEqual(
      sorted.map(workflow => workflow.id),
      [1, 2],
    );
    assert.deepStrictEqual(
      workflows.map(workflow => workflow.id),
      [2, 1],
    );
  });

  it('creates paginated summaries and readable output', () => {
    const workflows = normalizeWorkflowRows(
      [
        {
          id: 1,
          title: 'Login',
          status: 'draft',
          created_at: '2026-01-01',
          workflow_steps: [
            {
              id: 10,
              step_order: 1,
              action: 'click',
              action_value: null,
              description: 'Submit',
              selectors: {
                best_selector: '#submit',
                strategies: [{type: 'css', value: '#submit', priority: 1}],
                target_signature: {tag_name: 'button'},
              },
            },
          ],
        },
        {id: 2, title: 'Checkout', status: 'active', created_at: '2026-01-02'},
      ],
      {showSteps: true, showSelectorStrategies: true},
    );
    const page = createWorkflowListPage(workflows, {
      total: workflows.length,
      offset: 0,
      limit: 1,
      filters: {},
      sortBy: 'created_at',
      sortOrder: 'desc',
    });

    assert.strictEqual(page.workflows.length, 1);
    assert.strictEqual(page.total, 2);
    assert.strictEqual(page.has_next_page, true);
    assert.deepStrictEqual(summarizeWorkflowList(page), {
      workflow_count: 1,
      step_count: 1,
      action_counts: {click: 1},
    });
    const lines = formatWorkflowListLines(page).join('\n');
    assert.match(lines, /Found 2 workflow\(s\); showing 1-1\./);
    assert.match(lines, /Selector strategies: 1/);
    assert.match(lines, /Target signature: \{"tag_name":"button"\}/);

    const emptyPage = createWorkflowListPage([], {
      total: 2,
      offset: 2,
      limit: 1,
      filters: {},
      sortBy: 'created_at',
      sortOrder: 'desc',
    });
    assert.match(
      formatWorkflowListLines(emptyPage).join('\n'),
      /Found 2 workflow\(s\); no workflows on this page\./,
    );
  });

  it('normalizes hostname filters and LIKE patterns', () => {
    const hostname = normalizeWebsiteHostname('APP.Example.com/path');
    assert.strictEqual(hostname, 'app.example.com');
    assert.strictEqual(
      workflowMatchesHostname('https://app.example.com/login', hostname),
      true,
    );
    assert.strictEqual(
      workflowMatchesHostname('https://other.example.com', hostname),
      false,
    );
    assert.strictEqual(escapeLikePattern('a%b_\\c'), 'a\\%b\\_\\\\c');
  });
});
