/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  isVariableTemplate,
  validateWorkflowStepDefinition,
} from '../../src/tools/workflowValidation.js';

describe('workflow step validation', () => {
  it('recognizes variable templates without accepting arbitrary strings', () => {
    assert.strictEqual(isVariableTemplate('{{value}}'), true);
    assert.strictEqual(isVariableTemplate('{{ value }}'), true);
    assert.strictEqual(isVariableTemplate('value-{{other}}'), false);
  });

  it('validates element actions and required values', () => {
    assert.doesNotThrow(() =>
      validateWorkflowStepDefinition({
        action: 'type',
        uid: 'uid-1',
        actionValue: 'hello {{name}}',
      }),
    );

    assert.throws(
      () => validateWorkflowStepDefinition({action: 'click'}),
      /requires a uid/,
    );
    assert.throws(
      () => validateWorkflowStepDefinition({action: 'type', uid: 'uid-1'}),
      /requires action_value/,
    );
  });

  it('validates numeric, URL, and nested workflow values', () => {
    assert.doesNotThrow(() =>
      validateWorkflowStepDefinition({action: 'wait', actionValue: '0'}),
    );
    assert.doesNotThrow(() =>
      validateWorkflowStepDefinition({
        action: 'scroll',
        uid: 'uid-1',
        actionValue: '-300',
      }),
    );
    assert.doesNotThrow(() =>
      validateWorkflowStepDefinition({
        action: 'run_workflow',
        actionValue: '{{workflow_id}}',
      }),
    );

    assert.throws(
      () => validateWorkflowStepDefinition({action: 'wait', actionValue: '-1'}),
      /non-negative integer/,
    );
    assert.throws(
      () =>
        validateWorkflowStepDefinition({
          action: 'upload_image',
          uid: 'uid-1',
          actionValue: 'http://example.com/image.png',
        }),
      /HTTPS URL/,
    );
    assert.throws(
      () =>
        validateWorkflowStepDefinition({
          action: 'run_workflow',
          actionValue: '0',
        }),
      /positive integer workflow ID/,
    );
  });

  it('keeps choice keys and UIDs consistent', () => {
    const choices = {basic: 'uid-basic', premium: 'uid-premium'};
    assert.doesNotThrow(() =>
      validateWorkflowStepDefinition({
        action: 'choice_click',
        choices,
        actionValue: 'PREMIUM',
      }),
    );
    assert.doesNotThrow(() =>
      validateWorkflowStepDefinition({
        action: 'choice_click',
        choices,
        actionValue: '{{choice}}',
      }),
    );

    assert.throws(
      () =>
        validateWorkflowStepDefinition({
          action: 'choice_click',
          choices,
          actionValue: 'enterprise',
        }),
      /unknown choice/,
    );
    assert.throws(
      () =>
        validateWorkflowStepDefinition({
          action: 'choice_click',
          choices: {...choices, empty: ''},
          actionValue: 'basic',
        }),
      /requires a uid for choice "empty"/,
    );
  });
});
