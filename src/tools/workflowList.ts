/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type WorkflowSortField =
  | 'created_at'
  | 'title'
  | 'status'
  | 'website_url'
  | 'id';
export type WorkflowSortDirection = 'asc' | 'desc';

export interface WorkflowListOptions {
  showSteps: boolean;
  showSelectorStrategies: boolean;
  maxSteps?: number;
}

export interface WorkflowSelectorSummary {
  best_selector: string;
  strategy_count: number;
  strategies?: Array<{
    type: string;
    value: string;
    priority: number;
  }>;
  frame_selectors?: string[];
  target_signature?: Record<string, string>;
}

export interface WorkflowChoiceSelectors {
  choices: Record<string, WorkflowSelectorSummary>;
}

export interface WorkflowListStep {
  id: number | null;
  step_order: number;
  action: string;
  action_value: string | null;
  description: string | null;
  selectors: WorkflowSelectorSummary | WorkflowChoiceSelectors | null;
}

export interface WorkflowListItem {
  id: number;
  title: string;
  status: string | null;
  website_url: string | null;
  description: string | null;
  success_criteria: string | null;
  created_at: string | null;
  steps?: WorkflowListStep[];
  step_count?: number;
  steps_truncated?: boolean;
}

export interface WorkflowListPage {
  workflows: WorkflowListItem[];
  total: number;
  offset: number;
  limit: number | null;
  has_next_page: boolean;
  has_previous_page: boolean;
  filters: Record<string, string | undefined>;
  sort: {
    by: WorkflowSortField;
    order: WorkflowSortDirection;
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}

function normalizeDisplayValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeSelectorSummary(
  value: unknown,
  includeStrategies: boolean,
): WorkflowSelectorSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawStrategies = Array.isArray(value.strategies)
    ? value.strategies
        .filter(isRecord)
        .map(strategy => {
          const type = asString(strategy.type);
          const selectorValue = asString(strategy.value);
          const priority =
            typeof strategy.priority === 'number' ? strategy.priority : null;
          if (type === null || selectorValue === null || priority === null) {
            return null;
          }
          return {type, value: selectorValue, priority};
        })
        .filter(
          (
            strategy,
          ): strategy is {type: string; value: string; priority: number} =>
            strategy !== null,
        )
    : [];

  const summary: WorkflowSelectorSummary = {
    best_selector: asString(value.best_selector) ?? '',
    strategy_count: rawStrategies.length,
  };

  if (includeStrategies) {
    summary.strategies = rawStrategies;
    const frameSelectors = Array.isArray(value.frame_selectors)
      ? value.frame_selectors.filter(
          (selector): selector is string => typeof selector === 'string',
        )
      : [];
    if (frameSelectors.length > 0) {
      summary.frame_selectors = frameSelectors;
    }

    if (isRecord(value.target_signature)) {
      const targetSignature: Record<string, string> = {};
      for (const [key, entry] of Object.entries(value.target_signature)) {
        if (typeof entry === 'string') {
          targetSignature[key] = entry;
        }
      }
      if (Object.keys(targetSignature).length > 0) {
        summary.target_signature = targetSignature;
      }
    }
  }

  return summary;
}

function normalizeSelectors(
  value: unknown,
  includeStrategies: boolean,
): WorkflowSelectorSummary | WorkflowChoiceSelectors | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.choices)) {
    const choices: Record<string, WorkflowSelectorSummary> = {};
    for (const [choiceKey, choiceSelectors] of Object.entries(value.choices)) {
      const summary = normalizeSelectorSummary(
        choiceSelectors,
        includeStrategies,
      );
      if (summary) {
        choices[choiceKey] = summary;
      }
    }
    return {choices};
  }

  return normalizeSelectorSummary(value, includeStrategies);
}

function normalizeStep(
  value: unknown,
  includeStrategies: boolean,
): WorkflowListStep | null {
  if (!isRecord(value)) {
    return null;
  }

  const stepOrder = asSafeInteger(value.step_order);
  const action = normalizeDisplayValue(asString(value.action));
  if (stepOrder === null || action === null) {
    return null;
  }

  return {
    id: asSafeInteger(value.id),
    step_order: stepOrder,
    action,
    action_value: asString(value.action_value),
    description: asString(value.description),
    selectors: normalizeSelectors(value.selectors, includeStrategies),
  };
}

export function normalizeWorkflowRows(
  rows: unknown,
  options: WorkflowListOptions,
): WorkflowListItem[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const workflows: WorkflowListItem[] = [];
  for (const value of rows) {
    if (!isRecord(value)) {
      continue;
    }

    const id = asSafeInteger(value.id);
    if (id === null) {
      continue;
    }

    const rawSteps = Array.isArray(value.workflow_steps)
      ? value.workflow_steps
      : [];
    const steps = rawSteps
      .map(step => normalizeStep(step, options.showSelectorStrategies))
      .filter((step): step is WorkflowListStep => step !== null)
      .sort((a, b) => a.step_order - b.step_order || (a.id ?? 0) - (b.id ?? 0));

    const workflow: WorkflowListItem = {
      id,
      title: normalizeDisplayValue(asString(value.title)) ?? '(untitled)',
      status: normalizeDisplayValue(asString(value.status)),
      website_url: normalizeDisplayValue(asString(value.website_url)),
      description: normalizeDisplayValue(asString(value.description)),
      success_criteria: normalizeDisplayValue(asString(value.success_criteria)),
      created_at: asString(value.created_at),
    };

    if (options.showSteps) {
      workflow.step_count = steps.length;
      const visibleSteps =
        options.maxSteps === undefined
          ? steps
          : steps.slice(0, options.maxSteps);
      workflow.steps = visibleSteps;
      workflow.steps_truncated = visibleSteps.length < steps.length;
    }

    workflows.push(workflow);
  }

  return workflows;
}

function compareValues(
  left: string | number | null,
  right: string | number | null,
): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  const leftText = String(left).toLocaleLowerCase();
  const rightText = String(right).toLocaleLowerCase();
  return leftText < rightText ? -1 : 1;
}

export function sortWorkflowItems(
  items: WorkflowListItem[],
  sortBy: WorkflowSortField,
  sortOrder: WorkflowSortDirection,
): WorkflowListItem[] {
  const sorted = [...items];
  sorted.sort((left, right) => {
    const leftValue = sortBy === 'id' ? left.id : left[sortBy];
    const rightValue = sortBy === 'id' ? right.id : right[sortBy];
    const comparison = compareValues(leftValue, rightValue);
    if (comparison !== 0) {
      return sortOrder === 'asc' ? comparison : -comparison;
    }
    return left.id - right.id;
  });
  return sorted;
}

export function createWorkflowListPage(
  workflows: WorkflowListItem[],
  options: {
    total: number;
    offset: number;
    limit?: number;
    filters: Record<string, string | undefined>;
    sortBy: WorkflowSortField;
    sortOrder: WorkflowSortDirection;
    alreadyPaginated?: boolean;
  },
): WorkflowListPage {
  const pageWorkflows = options.alreadyPaginated
    ? workflows
    : workflows.slice(
        options.offset,
        options.limit === undefined
          ? undefined
          : options.offset + options.limit,
      );
  const returned = pageWorkflows.length;

  return {
    workflows: pageWorkflows,
    total: options.total,
    offset: options.offset,
    limit: options.limit ?? null,
    has_next_page: options.offset + returned < options.total,
    has_previous_page: options.offset > 0 && options.total > 0,
    filters: options.filters,
    sort: {
      by: options.sortBy,
      order: options.sortOrder,
    },
  };
}

function displayValue(value: string | null, fallback: string): string {
  return value === null
    ? fallback
    : value.replace(/\s+/g, ' ').trim() || fallback;
}

function appendSelectorLines(
  lines: string[],
  prefix: string,
  selector: WorkflowSelectorSummary,
): void {
  lines.push(
    `${prefix}Selector: ${displayValue(selector.best_selector, '(none)')}`,
  );
  lines.push(`${prefix}Selector strategies: ${selector.strategy_count}`);
  if (selector.strategies) {
    for (const strategy of selector.strategies) {
      lines.push(
        `${prefix}  - ${strategy.type} = ${displayValue(strategy.value, '(empty)')} (priority ${strategy.priority})`,
      );
    }
  }
  if (selector.frame_selectors && selector.frame_selectors.length > 0) {
    lines.push(
      `${prefix}Frame selectors: ${selector.frame_selectors.map(frameSelector => displayValue(frameSelector, '(empty)')).join(' -> ')}`,
    );
  }
  if (selector.target_signature) {
    lines.push(
      `${prefix}Target signature: ${JSON.stringify(selector.target_signature)}`,
    );
  }
}

export function formatWorkflowListLines(page: WorkflowListPage): string[] {
  const lines: string[] = [];
  if (page.total === 0) {
    lines.push('No workflows found.');
    return lines;
  }

  if (page.workflows.length === 0) {
    lines.push(`Found ${page.total} workflow(s); no workflows on this page.`);
    if (page.has_previous_page) {
      lines.push(
        `Previous page starts at offset ${Math.max(0, page.offset - (page.limit ?? 1))}.`,
      );
    }
    return lines;
  }

  const start = page.offset + 1;
  const end = page.offset + page.workflows.length;
  lines.push(`Found ${page.total} workflow(s); showing ${start}-${end}.`);
  if (page.has_previous_page) {
    lines.push(
      `Previous page starts at offset ${Math.max(0, page.offset - (page.limit ?? page.workflows.length))}.`,
    );
  }
  if (page.has_next_page) {
    lines.push(
      `Next page starts at offset ${page.offset + page.workflows.length}.`,
    );
  }

  for (const workflow of page.workflows) {
    lines.push(
      `Workflow: ${displayValue(workflow.title, '(untitled)')} (ID: ${workflow.id})`,
    );
    lines.push(`  Status: ${displayValue(workflow.status, '(unknown)')}`);
    if (workflow.website_url) {
      lines.push(`  URL: ${displayValue(workflow.website_url, '(none)')}`);
    }
    if (workflow.description) {
      lines.push(
        `  Description: ${displayValue(workflow.description, '(none)')}`,
      );
    }
    if (workflow.success_criteria) {
      lines.push(
        `  Success criteria: ${displayValue(workflow.success_criteria, '(none)')}`,
      );
    }
    if (workflow.steps) {
      const truncation = workflow.steps_truncated
        ? ` of ${workflow.step_count}`
        : '';
      lines.push(`  Steps (${workflow.steps.length}${truncation}):`);
      if (workflow.steps.length === 0) {
        lines.push('    (none)');
      }
      for (const step of workflow.steps) {
        const value =
          step.action_value === null
            ? ''
            : `; value=${displayValue(step.action_value, '(empty)')}`;
        const description = displayValue(step.description, '(no description)');
        lines.push(
          `    ${step.step_order}. ${step.action} - ${description}${value}`,
        );

        if (step.selectors && 'choices' in step.selectors) {
          const choiceKeys = Object.keys(step.selectors.choices);
          lines.push(
            `      Choices (${choiceKeys.length}): ${choiceKeys.map(choiceKey => displayValue(choiceKey, '(unnamed)')).join(', ') || '(none)'}`,
          );
          for (const choiceKey of choiceKeys) {
            appendSelectorLines(
              lines,
              `        ${displayValue(choiceKey, '(unnamed)')} `,
              step.selectors.choices[choiceKey],
            );
          }
        } else if (step.selectors) {
          appendSelectorLines(lines, '      ', step.selectors);
        }
      }
    }
    lines.push('---');
  }

  return lines;
}

export function summarizeWorkflowList(page: WorkflowListPage): {
  workflow_count: number;
  step_count: number;
  action_counts: Record<string, number>;
} {
  const actionCounts: Record<string, number> = {};
  let stepCount = 0;
  for (const workflow of page.workflows) {
    for (const step of workflow.steps ?? []) {
      stepCount++;
      actionCounts[step.action] = (actionCounts[step.action] ?? 0) + 1;
    }
  }
  return {
    workflow_count: page.workflows.length,
    step_count: stepCount,
    action_counts: actionCounts,
  };
}

export function normalizeWebsiteHostname(value: string): string {
  const candidate = value.includes('://') ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid website URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('website_url must use http or https protocol.');
  }
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

export function workflowMatchesHostname(
  websiteUrl: string | null,
  hostname: string,
): boolean {
  if (!websiteUrl) {
    return false;
  }
  try {
    const storedHostname = normalizeWebsiteHostname(websiteUrl);
    return storedHostname === hostname;
  } catch {
    return false;
  }
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}
