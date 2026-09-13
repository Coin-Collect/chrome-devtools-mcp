/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ListChoiceClickAction,
  ListChoiceSelectorsData,
  ListChoiceWorkflowAction,
  PersistedChoiceAction,
  WorkflowVariable,
} from './workflowTypes.js';

const VARIABLE_REFERENCE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const WHOLE_VARIABLE_PATTERN = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

export interface WorkflowValueStep {
  action: string;
  action_value: string | null;
  step_order: number;
  description: string | null;
}

export interface ListChoiceSelection {
  key: string;
  action: PersistedChoiceAction;
}

export interface ListChoiceExecutionCallbacks {
  click: (key: string, action: ListChoiceClickAction) => Promise<void>;
  runWorkflow: (key: string, action: ListChoiceWorkflowAction) => Promise<void>;
}

function hasOwn<T extends object>(object: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function variablePattern(): RegExp {
  return new RegExp(VARIABLE_REFERENCE_PATTERN.source, 'g');
}

export function getWorkflowVariableNames(value: string): string[] {
  const names: string[] = [];
  const pattern = variablePattern();
  let match = pattern.exec(value);
  while (match) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
    match = pattern.exec(value);
  }
  return names;
}

export function resolveWorkflowValue(
  template: string,
  variables: Record<string, WorkflowVariable>,
  allowArray: boolean,
): string | string[] {
  const trimmedTemplate = template.trim();
  const wholeMatch = WHOLE_VARIABLE_PATTERN.exec(trimmedTemplate);
  if (wholeMatch) {
    const variableName = wholeMatch[1];
    if (!hasOwn(variables, variableName)) {
      throw new Error(`Missing workflow variable "${variableName}".`);
    }
    const value = variables[variableName];
    if (Array.isArray(value) && !allowArray) {
      throw new Error(
        `Workflow variable "${variableName}" must be a string for this action.`,
      );
    }
    return value;
  }

  const variableNames = getWorkflowVariableNames(template);
  for (const variableName of variableNames) {
    if (!hasOwn(variables, variableName)) {
      throw new Error(`Missing workflow variable "${variableName}".`);
    }
    if (Array.isArray(variables[variableName])) {
      throw new Error(
        `Workflow variable "${variableName}" can only be used as a whole action value when it is a list.`,
      );
    }
  }

  return template.replace(variablePattern(), (_match, variableName: string) => {
    const value = variables[variableName];
    return typeof value === 'string' ? value : '';
  });
}

export function collectMissingWorkflowVariables(
  steps: WorkflowValueStep[],
  variables: Record<string, WorkflowVariable>,
): Array<{variable: string; stepOrder: number; description: string}> {
  const missing: Array<{
    variable: string;
    stepOrder: number;
    description: string;
  }> = [];
  for (const step of steps) {
    if (!step.action_value) {
      continue;
    }
    for (const variable of getWorkflowVariableNames(step.action_value)) {
      if (!hasOwn(variables, variable)) {
        missing.push({
          variable,
          stepOrder: step.step_order,
          description: step.description || step.action,
        });
      }
    }
  }
  return missing;
}

export function validateWorkflowRuntimeVariables(
  steps: WorkflowValueStep[],
  variables: Record<string, WorkflowVariable>,
): void {
  const missing = collectMissingWorkflowVariables(steps, variables);
  if (missing.length > 0) {
    const names = [...new Set(missing.map(item => item.variable))];
    throw new Error(`Missing workflow variables: ${names.join(', ')}`);
  }

  for (const step of steps) {
    if (!step.action_value || step.action === 'list_choice') {
      continue;
    }
    resolveWorkflowValue(step.action_value, variables, false);
  }
}

function parseChoiceKeys(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item !== 'string') {
        throw new Error('list_choice action_value must contain only strings.');
      }
      const trimmed = item.trim();
      if (!trimmed) {
        throw new Error('list_choice cannot contain a blank choice key.');
      }
      return trimmed;
    });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('list_choice requires at least one choice key.');
  }
  if (!trimmed.startsWith('[')) {
    return [trimmed];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('list_choice action_value contains malformed JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'list_choice action_value must be a JSON array of strings.',
    );
  }
  return parsed.map(item => {
    if (typeof item !== 'string') {
      throw new Error('list_choice action_value must contain only strings.');
    }
    const choiceKey = item.trim();
    if (!choiceKey) {
      throw new Error('list_choice cannot contain a blank choice key.');
    }
    return choiceKey;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePersistedChoiceAction(
  choiceKey: string,
  action: PersistedChoiceAction,
): void {
  if (
    !isRecord(action) ||
    (action.action !== 'click' && action.action !== 'run_workflow')
  ) {
    throw new Error(
      `list_choice option "${choiceKey}" has an invalid action descriptor.`,
    );
  }

  if (action.action === 'run_workflow') {
    if (
      typeof action.workflow_id !== 'number' ||
      !Number.isSafeInteger(action.workflow_id) ||
      action.workflow_id <= 0
    ) {
      throw new Error(
        `list_choice option "${choiceKey}" has an invalid workflow_id.`,
      );
    }
    return;
  }

  const selectors = action.selectors;
  if (!isRecord(selectors) || typeof selectors.best_selector !== 'string') {
    throw new Error(
      `list_choice option "${choiceKey}" has invalid click selectors.`,
    );
  }
  if (
    !Array.isArray(selectors.strategies) ||
    selectors.strategies.some(
      strategy =>
        !isRecord(strategy) ||
        typeof strategy.type !== 'string' ||
        typeof strategy.value !== 'string' ||
        !Number.isFinite(strategy.priority),
    ) ||
    !isRecord(selectors.ax_node_meta) ||
    typeof selectors.ax_node_meta.role !== 'string' ||
    typeof selectors.ax_node_meta.name !== 'string' ||
    typeof selectors.ax_node_meta.description !== 'string'
  ) {
    throw new Error(
      `list_choice option "${choiceKey}" has invalid click selectors.`,
    );
  }
  if (
    selectors.frame_selectors !== undefined &&
    (!Array.isArray(selectors.frame_selectors) ||
      selectors.frame_selectors.some(selector => typeof selector !== 'string'))
  ) {
    throw new Error(
      `list_choice option "${choiceKey}" has invalid frame selectors.`,
    );
  }
}

function validateConfiguredChoiceKeys(
  choiceActions: Record<string, PersistedChoiceAction>,
): void {
  if (!isRecord(choiceActions) || Object.keys(choiceActions).length === 0) {
    throw new Error('list_choice requires configured choice actions.');
  }
  const seen = new Set<string>();
  for (const key of Object.keys(choiceActions)) {
    const trimmed = key.trim();
    if (!trimmed || trimmed !== key) {
      throw new Error(
        'list_choice configuration contains a blank or padded choice key.',
      );
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(
        `list_choice configuration contains case-colliding choice key "${key}".`,
      );
    }
    seen.add(normalized);
  }
}

export function resolveListChoiceSelection(
  actionValue: string,
  selectors: ListChoiceSelectorsData,
  variables: Record<string, WorkflowVariable>,
): ListChoiceSelection[] {
  const resolved = resolveWorkflowValue(actionValue, variables, true);
  const requestedKeys = parseChoiceKeys(resolved);
  validateConfiguredChoiceKeys(selectors.choice_actions);

  const selected: ListChoiceSelection[] = [];
  const seen = new Set<string>();
  for (const requestedKey of requestedKeys) {
    const normalized = requestedKey.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(
        `list_choice contains duplicate choice "${requestedKey}".`,
      );
    }
    seen.add(normalized);

    const configuredKey = Object.keys(selectors.choice_actions).find(
      key => key.toLowerCase() === normalized,
    );
    if (!configuredKey || !hasOwn(selectors.choice_actions, configuredKey)) {
      throw new Error(
        `Unknown list_choice option "${requestedKey}". Available options: ${Object.keys(selectors.choice_actions).join(', ')}`,
      );
    }
    selected.push({
      key: configuredKey,
      action: selectors.choice_actions[configuredKey],
    });
  }
  for (const item of selected) {
    validatePersistedChoiceAction(item.key, item.action);
  }
  return selected;
}

export async function executeListChoiceActions(
  actionValue: string,
  selectors: ListChoiceSelectorsData,
  variables: Record<string, WorkflowVariable>,
  callbacks: ListChoiceExecutionCallbacks,
): Promise<ListChoiceSelection[]> {
  const selected = resolveListChoiceSelection(
    actionValue,
    selectors,
    variables,
  );
  for (const item of selected) {
    if (item.action.action === 'click') {
      await callbacks.click(item.key, item.action);
    } else if (item.action.action === 'run_workflow') {
      await callbacks.runWorkflow(item.key, item.action);
    }
  }
  return selected;
}

export function assertWorkflowCallIsNotRecursive(
  workflowPath: number[],
  workflowId: number,
): void {
  if (workflowPath.includes(workflowId)) {
    throw new Error(
      `Recursive workflow call detected: ${[...workflowPath, workflowId].join(' -> ')}`,
    );
  }
}
