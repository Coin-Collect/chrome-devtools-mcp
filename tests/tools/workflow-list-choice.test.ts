/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {before, it} from 'node:test';
import type {TestContext} from 'node:test';

import type {ParsedArguments} from '../../src/bin/chrome-devtools-mcp-cli-options.js';
import {McpResponse} from '../../src/McpResponse.js';
import {zod} from '../../src/third_party/index.js';
import type {Context, ContextPage} from '../../src/tools/ToolDefinition.js';
import type * as WorkflowTools from '../../src/tools/workflow.js';

let tools: typeof WorkflowTools;
before(async () => {
  process.env.SUPABASE_URL = 'https://workflow-tests.invalid';
  process.env.SUPABASE_KEY = 'synthetic-test-key';
  tools = await import('../../src/tools/workflow.js');
});

const option = {action: 'run_workflow' as const, workflow_id: 2};
const config = {choice_actions: {cheese: option}};
const step = (action: string, value: string, selectors?: unknown) => ({
  id: 1,
  workflow_id: 1,
  step_order: 1,
  action,
  action_value: value,
  selectors: selectors ?? null,
  description: null,
});
const page = {
  pptrPage: {
    evaluate: async () => undefined,
    url: () => 'about:blank',
    browser: () => ({}),
  },
} as unknown as ContextPage;
const response = () => new McpResponse({} as ParsedArguments);
const context = {} as Context;

function mockWorkflows(t: TestContext, workflows: Record<number, unknown[]>) {
  const fetched: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    assert.equal(url.hostname, 'workflow-tests.invalid');
    const id = Number(url.searchParams.get('workflow_id')?.replace('eq.', ''));
    fetched.push(id);
    return new Response(JSON.stringify(workflows[id] ?? []), {
      headers: {'Content-Type': 'application/json'},
    });
  });
  return fetched;
}

it('accepts typed list variables and strict action descriptors in tool schemas', () => {
  assert.deepEqual(
    zod.object(tools.runWorkflow.schema).parse({
      workflow_id: 1,
      variables: {ingredients: ['cheese']},
    }).variables,
    {ingredients: ['cheese']},
  );
  const schema = zod.object(tools.addWorkflowStep.schema);
  assert.equal(
    schema.safeParse({
      workflow_id: 1,
      action: 'list_choice',
      choice_actions: {cheese: option},
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      workflow_id: 1,
      action: 'list_choice',
      choice_actions: {cheese: {...option, uid: '1_1'}},
    }).success,
    false,
  );
});

it('records workflow-only choices without a selected page and validates before inserting', async t => {
  const inserted: Array<Record<string, unknown>> = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init: RequestInit) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      let data: unknown = url.pathname.endsWith('/workflows') ? {id: 1} : null;
      if (init.method === 'POST') {
        const row = JSON.parse(init.body as string)[0];
        inserted.push(row);
        data = {...row, id: 20};
      }
      return new Response(JSON.stringify(data), {
        headers: {'Content-Type': 'application/json'},
      });
    },
  );
  const params = {
    workflow_id: 1,
    step_order: 1,
    action: 'list_choice' as const,
    choice_actions: {cheese: option},
    action_value: '["cheese"]',
  };
  await tools.addWorkflowStep.handler({params}, response(), context);
  assert.deepEqual(inserted[0].selectors, config);
  await assert.rejects(
    tools.addWorkflowStep.handler(
      {
        params: {
          ...params,
          action_value: '["cheese","missing"]',
        },
      },
      response(),
      context,
    ),
    /Unknown list_choice/,
  );
  assert.equal(inserted.length, 1);
});

it('rejects the full selection before fetching any chosen workflow', async t => {
  const fetched = mockWorkflows(t, {
    1: [step('list_choice', '["cheese","missing"]', config)],
  });
  await assert.rejects(
    tools.runWorkflow.handler(
      {page, params: {workflow_id: 1}},
      response(),
      context,
    ),
    /Unknown list_choice/,
  );
  assert.deepEqual(fetched, [1]);
});

it('propagates failure through grandchildren and stops subsequent outer steps', async t => {
  const fetched = mockWorkflows(t, {
    1: [step('list_choice', 'cheese', config), step('run_workflow', '99')],
    2: [step('run_workflow', '3'), step('run_workflow', '98')],
    3: [step('invalid_action', ''), step('run_workflow', '97')],
  });
  await assert.rejects(
    tools.runWorkflow.handler(
      {page, params: {workflow_id: 1}},
      response(),
      context,
    ),
    /Unknown action/,
  );
  assert.deepEqual(fetched, [1, 2, 3]);
});

it('detects recursion across list and ordinary nested workflow calls', async t => {
  const fetched = mockWorkflows(t, {
    1: [step('list_choice', 'cheese', config)],
    2: [step('run_workflow', '1')],
  });
  await assert.rejects(
    tools.runWorkflow.handler(
      {page, params: {workflow_id: 1}},
      response(),
      context,
    ),
    /Recursive workflow/,
  );
  assert.deepEqual(fetched, [1, 2]);
});

it('inherits list variables into child workflows and allows empty selections', async t => {
  const fetched = mockWorkflows(t, {
    1: [step('list_choice', '{{ingredients}}', config)],
    2: [step('list_choice', '{{optional}}', config)],
  });
  await tools.runWorkflow.handler(
    {
      page,
      params: {
        workflow_id: 1,
        variables: {ingredients: ['cheese'], optional: []},
      },
    },
    response(),
    context,
  );
  assert.deepEqual(fetched, [1, 2]);
});

it('simulates lists and unresolved selections without executing child workflows', async t => {
  const fetched = mockWorkflows(t, {
    1: [step('list_choice', '{{ingredients}}', config)],
  });
  const preview = response();
  await tools.simulateWorkflow.handler(
    {page, params: {workflow_id: 1, pause_ms: 1}},
    preview,
    context,
  );
  assert.match(preview.responseLines.join('\n'), /cheese: run_workflow 2/);
  assert.match(
    preview.responseLines.join('\n'),
    /Runtime selection requires variables: ingredients/,
  );
  const resolved = response();
  await tools.simulateWorkflow.handler(
    {
      page,
      params: {
        workflow_id: 1,
        pause_ms: 1,
        variables: {ingredients: ['cheese']},
      },
    },
    resolved,
    context,
  );
  assert.match(resolved.responseLines.join('\n'), /Would run workflow 2/);
  assert.deepEqual(fetched, [1, 1]);
});

it('preserves saved selectors for partial updates and rejects incompatible edits before writes', async t => {
  const existing = step('list_choice', '{{ingredients}}', config);
  const patches: Array<Record<string, unknown>> = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: unknown, init: RequestInit) => {
      const body =
        init.method === 'PATCH' ? JSON.parse(init.body as string) : null;
      if (body) {
        patches.push(body);
      }
      return new Response(JSON.stringify({...existing, ...body}), {
        headers: {'Content-Type': 'application/json'},
      });
    },
  );
  await tools.updateWorkflowStep.handler(
    {
      page,
      params: {
        workflow_id: 1,
        step_order: 1,
        action_value: '["cheese"]',
      },
    },
    response(),
    context,
  );
  assert.equal(Object.hasOwn(patches[0], 'selectors'), false);
  await tools.updateWorkflowStep.handler(
    {
      page,
      params: {
        workflow_id: 1,
        step_order: 1,
        choice_actions: {cheese: {...option, workflow_id: 3}},
      },
    },
    response(),
    context,
  );
  assert.deepEqual(patches[1].selectors, {
    choice_actions: {cheese: {action: 'run_workflow', workflow_id: 3}},
  });
  for (const edit of [
    {choice_actions: {}},
    {action: 'click' as const},
    {action_value: '["unknown"]'},
  ]) {
    await assert.rejects(
      tools.updateWorkflowStep.handler(
        {
          page,
          params: {
            workflow_id: 1,
            step_order: 1,
            ...edit,
          },
        },
        response(),
        context,
      ),
    );
  }
  assert.equal(patches.length, 2);
});
