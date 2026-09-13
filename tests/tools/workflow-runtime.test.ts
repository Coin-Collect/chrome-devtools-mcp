/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {it} from 'node:test';

import {
  executeListChoiceActions,
  resolveListChoiceSelection,
  resolveWorkflowValue,
} from '../../src/tools/workflowRuntime.js';
import type {ListChoiceSelectorsData} from '../../src/tools/workflowTypes.js';

const selectors: ListChoiceSelectorsData = {
  choice_actions: {
    mushroom: {
      action: 'click',
      selectors: {
        best_selector: '#mushroom',
        strategies: [{type: 'id', value: '#mushroom', priority: 1}],
        ax_node_meta: {role: 'button', name: 'Mushroom', description: ''},
      },
    },
    cheese: {action: 'run_workflow', workflow_id: 2},
  },
};

it('resolves native lists, JSON lists, single options and empty lists', () => {
  for (const ingredients of [
    [' CHEESE ', 'mushroom'],
    '["cheese","mushroom"]',
  ]) {
    assert.deepEqual(
      resolveListChoiceSelection('{{ingredients}}', selectors, {
        ingredients,
      }).map(x => x.key),
      ['cheese', 'mushroom'],
    );
  }
  assert.equal(
    resolveListChoiceSelection('mushroom', selectors, {})[0].key,
    'mushroom',
  );
  assert.deepEqual(resolveListChoiceSelection('[]', selectors, {}), []);
});

it('rejects invalid complete lists before invoking any action', async () => {
  let calls = 0;
  const callback = async () => {
    calls++;
  };
  for (const value of [
    '["mushroom","unknown"]',
    '["mushroom","MUSHROOM"]',
    '["mushroom",1]',
    '["mushroom",null]',
    '[" "]',
    '[',
    '',
    'toString',
  ]) {
    await assert.rejects(
      executeListChoiceActions(
        value,
        selectors,
        {},
        {
          click: callback,
          runWorkflow: callback,
        },
      ),
    );
    assert.equal(calls, 0);
  }
});

it('validates stored descriptors before earlier selected actions execute', async () => {
  let calls = 0;
  const callback = async () => {
    calls++;
  };
  for (const invalid of [
    {action: 'other', workflow_id: 2},
    {action: 'run_workflow', workflow_id: 0},
    {action: 'click', selectors: null},
    {
      action: 'click',
      selectors: {
        best_selector: '#x',
        strategies: [null],
        ax_node_meta: {role: '', name: '', description: ''},
      },
    },
  ]) {
    const config = {
      choice_actions: {...selectors.choice_actions, invalid},
    } as ListChoiceSelectorsData;
    await assert.rejects(
      executeListChoiceActions(
        '["cheese","invalid"]',
        config,
        {},
        {
          click: callback,
          runWorkflow: callback,
        },
      ),
    );
    assert.equal(calls, 0);
  }
});

it('awaits each mixed action and stops on failure', async () => {
  const events: string[] = [];
  await executeListChoiceActions(
    '["cheese","mushroom"]',
    selectors,
    {},
    {
      runWorkflow: async key => {
        await Promise.resolve();
        events.push(key);
      },
      click: async key => {
        assert.deepEqual(events, ['cheese']);
        events.push(key);
      },
    },
  );
  assert.deepEqual(events, ['cheese', 'mushroom']);
  await assert.rejects(
    executeListChoiceActions(
      '["cheese","mushroom"]',
      selectors,
      {},
      {
        runWorkflow: async () => {
          throw new Error('child failed');
        },
        click: async () => {
          assert.fail('later click executed');
        },
      },
    ),
    /child failed/,
  );
});

it('preserves scalar substitution and prevents list coercion or inherited variables', () => {
  assert.equal(
    resolveWorkflowValue('Hello {{name}}', {name: 'Ada'}, false),
    'Hello Ada',
  );
  assert.throws(
    () => resolveWorkflowValue('{{items}}', {items: ['cheese']}, false),
    /must be a string/,
  );
  assert.throws(
    () => resolveWorkflowValue('prefix {{items}}', {items: ['cheese']}, true),
    /whole action value/,
  );
  assert.throws(
    () => resolveWorkflowValue('{{toString}}', {}, false),
    /Missing/,
  );
  const collision = {
    choice_actions: {
      A: selectors.choice_actions.cheese,
      a: selectors.choice_actions.cheese,
    },
  };
  assert.throws(
    () => resolveListChoiceSelection('a', collision, {}),
    /case-colliding/,
  );
});
