/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {commands} from '../../src/bin/rockstarxCliDefinitions.js';
import {renderRockstarHelp} from '../../src/bin/rockstarxHelp.js';

describe('Rockstar CLI help', () => {
  it('groups commands in task order and hides optional arguments', () => {
    const help = renderRockstarHelp(commands, 100);

    assert.ok(help.includes('Page inspection:'));
    assert.ok(help.includes('Human interaction:'));
    assert.ok(help.includes('Workflow management:'));
    assert.ok(help.includes('Workflow steps:'));
    assert.ok(help.includes('Workflow execution:'));
    assert.ok(
      help.indexOf('add_workflow_step') < help.indexOf('update_workflow_step'),
    );
    assert.ok(
      help.indexOf('update_workflow_step') < help.indexOf('delete_workflow_step'),
    );
    assert.ok(!help.includes('take_snapshot [--verbose]'));
  });

  it('uses a stacked layout in narrow terminals', () => {
    const help = renderRockstarHelp(commands, 48);

    assert.ok(
      help.includes(
        '  run_workflow <workflow_id>\n    Run a workflow or one selected step',
      ),
    );
  });
});
