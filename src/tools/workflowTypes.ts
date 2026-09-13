/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {SelectorStrategy} from './workflowSelectors.js';

export interface ElementSignature {
  tag_name: string;
  id: string;
  role: string;
  aria_label: string;
  name: string;
  type: string;
  placeholder: string;
  test_id: string;
  title: string;
  href: string;
  text: string;
}

export interface SelectorsData {
  best_selector: string;
  strategies: SelectorStrategy[];
  ax_node_meta: {
    role: string;
    name: string;
    description: string;
  };
  target_signature?: ElementSignature;
  frame_selectors?: string[];
}

export interface ChoiceSelectorsData {
  choices: Record<string, SelectorsData>;
}

export interface ListChoiceClickAction {
  action: 'click';
  selectors: SelectorsData;
}

export interface ListChoiceWorkflowAction {
  action: 'run_workflow';
  workflow_id: number;
}

export type PersistedChoiceAction =
  | ListChoiceClickAction
  | ListChoiceWorkflowAction;

export interface ListChoiceSelectorsData {
  choice_actions: Record<string, PersistedChoiceAction>;
}

export type WorkflowSelectors =
  | SelectorsData
  | ChoiceSelectorsData
  | ListChoiceSelectorsData;

export type WorkflowVariable = string | string[];

export type ChoiceActionDefinition =
  | {action: 'click'; uid: string}
  | {action: 'run_workflow'; workflow_id: number};
