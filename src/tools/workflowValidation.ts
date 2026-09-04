/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const VARIABLE_TEMPLATE_PATTERN = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

const ELEMENT_REQUIRED_ACTIONS = new Set([
  'click',
  'type',
  'hover',
  'extract',
  'scroll',
  'upload_image',
]);

export interface WorkflowStepValidationInput {
  action: string;
  actionValue?: string;
  uid?: string;
  choices?: Record<string, string>;
}

export function isVariableTemplate(value: string): boolean {
  return VARIABLE_TEMPLATE_PATTERN.test(value.trim());
}

function requireActionValue(
  action: string,
  actionValue: string | undefined,
): string {
  if (actionValue === undefined || actionValue.trim() === '') {
    throw new Error(`Action "${action}" requires action_value.`);
  }
  return actionValue.trim();
}

function validateIntegerActionValue(
  action: string,
  actionValue: string | undefined,
  options: {allowNegative: boolean},
): void {
  if (actionValue === undefined) {
    return;
  }

  const value = actionValue.trim();
  if (value === '' || isVariableTemplate(value)) {
    if (value === '') {
      throw new Error(`Action "${action}" requires an integer action_value.`);
    }
    return;
  }

  const parsedValue = Number(value);
  const isInteger = /^-?\d+$/.test(value) && Number.isSafeInteger(parsedValue);
  const isAllowed = options.allowNegative || parsedValue >= 0;
  if (!isInteger || !isAllowed) {
    const range = options.allowNegative
      ? 'an integer'
      : 'a non-negative integer';
    throw new Error(
      `Action "${action}" requires ${range} action_value or a variable template.`,
    );
  }
}

function validateHttpsUrlActionValue(
  action: string,
  actionValue: string | undefined,
): string {
  const value = requireActionValue(action, actionValue);
  if (isVariableTemplate(value)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Action "${action}" requires a valid HTTPS URL or a variable template.`,
    );
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Action "${action}" requires an HTTPS URL.`);
  }
  return value;
}

export function validateWorkflowStepDefinition({
  action,
  actionValue,
  uid,
  choices,
}: WorkflowStepValidationInput): void {
  const normalizedUid = uid?.trim();

  if (action === 'choice_click') {
    if (uid !== undefined) {
      throw new Error(
        'The uid parameter cannot be used with action "choice_click"; provide one uid per choice in choices.',
      );
    }
    if (!choices || Object.keys(choices).length === 0) {
      throw new Error(
        'Action "choice_click" requires a choices parameter mapping choice keys to element uids.',
      );
    }

    const choiceKeys = Object.keys(choices);
    for (const [choiceKey, choiceUid] of Object.entries(choices)) {
      if (choiceKey.trim() === '' || choiceKey !== choiceKey.trim()) {
        throw new Error(
          'Action "choice_click" received an invalid choice key. Keys must not be empty or padded with whitespace.',
        );
      }
      if (choiceUid.trim() === '') {
        throw new Error(
          `Action "choice_click" requires a uid for choice "${choiceKey}".`,
        );
      }
    }

    const selectedChoice = requireActionValue(action, actionValue);
    if (
      !isVariableTemplate(selectedChoice) &&
      !choiceKeys.some(
        key => key.toLowerCase() === selectedChoice.toLowerCase(),
      )
    ) {
      throw new Error(
        `Action "choice_click" references unknown choice "${selectedChoice}". Available choices: ${choiceKeys.join(', ')}`,
      );
    }
    return;
  }

  if (choices !== undefined) {
    throw new Error(
      `The choices parameter can only be used with action "choice_click".`,
    );
  }

  if (ELEMENT_REQUIRED_ACTIONS.has(action) && !normalizedUid) {
    throw new Error(
      `Action "${action}" requires a uid parameter to identify the target element.`,
    );
  }

  if (!ELEMENT_REQUIRED_ACTIONS.has(action) && uid !== undefined) {
    throw new Error(
      `The uid parameter can only be used with an element-based action.`,
    );
  }

  switch (action) {
    case 'type':
      requireActionValue(action, actionValue);
      break;
    case 'wait':
      validateIntegerActionValue(action, actionValue, {allowNegative: false});
      break;
    case 'scroll':
      validateIntegerActionValue(action, actionValue, {allowNegative: true});
      break;
    case 'nav':
      validateHttpsUrlActionValue(action, actionValue);
      break;
    case 'upload_image':
      validateHttpsUrlActionValue(action, actionValue);
      break;
    case 'run_workflow': {
      const value = requireActionValue(action, actionValue);
      if (!isVariableTemplate(value)) {
        const workflowId = Number(value);
        if (
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(workflowId) ||
          workflowId <= 0
        ) {
          throw new Error(
            'Action "run_workflow" requires a positive integer workflow ID or a variable template.',
          );
        }
      }
      break;
    }
    default:
      break;
  }
}
