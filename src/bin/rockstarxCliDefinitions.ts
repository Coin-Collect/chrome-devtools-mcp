/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ArgDef {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string | number | boolean;
  enum?: ReadonlyArray<string | number>;
}
export type Commands = Record<
  string,
  {
    description: string;
    category: string;
    args: Record<string, ArgDef>;
  }
>;
export const commands: Commands = {
  take_snapshot: {
    description:
      'Take a text snapshot of the currently selected page based on the a11y tree. The snapshot lists page elements along with a unique\nidentifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot. The snapshot indicates the element selected\nin the DevTools Elements panel (if any).',
    category: 'Debugging',
    args: {
      verbose: {
        name: 'verbose',
        type: 'boolean',
        description:
          'Whether to include all possible information available in the full a11y tree. Default is false.',
        required: false,
      },
      filePath: {
        name: 'filePath',
        type: 'string',
        description:
          'The absolute path, or a path relative to the current working directory, to save the snapshot to instead of attaching it to the response.',
        required: false,
      },
    },
  },
  click_like_human: {
    description: 'Clicks on an element with fully realistic human behavior: scrolls into view using mouse wheel with momentum, moves the cursor along a natural Bezier curve path, hovers briefly, then performs a mousedown/mouseup with natural hold timing. A symbolic cursor is displayed during the interaction. NOTE: Unless otherwise specified, prefer this tool over the standard click tool.',
    category: 'Input automation',
    args: {
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot',
        required: true,
      },
    },
  },
  type_like_human: {
    description: 'Types text into an element with fully realistic human behavior: scrolls into view, moves the cursor naturally to the element, clicks to focus with natural mousedown/mouseup, pauses briefly, then types each character using keyboard.down/up with natural hold durations, inter-key delays matching ~55 WPM, Shift key handling for uppercase, and occasional typos that are corrected with Backspace. NOTE: Unless otherwise specified, prefer this tool over the standard type tool.',
    category: 'Input automation',
    args: {
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot',
        required: true,
      },
      text: {
        name: 'text',
        type: 'string',
        description: 'The text to type into the element',
        required: true,
      },
    },
  },
  create_workflow: {
    description: 'Creates a new workflow in the database',
    category: 'Input automation',
    args: {
      title: {
        name: 'title',
        type: 'string',
        description: 'The title of the workflow',
        required: true,
      },
      website_url: {
        name: 'website_url',
        type: 'string',
        description: 'The target website URL for the workflow',
        required: false,
      },
      description: {
        name: 'description',
        type: 'string',
        description: 'A description of what the workflow does',
        required: false,
      },
      success_criteria: {
        name: 'success_criteria',
        type: 'string',
        description: 'Criteria to determine if the workflow succeeded',
        required: false,
      },
    },
  },
  list_workflows: {
    description: 'Lists all workflows and their steps from the database',
    category: 'Input automation',
    args: {},
  },
  add_workflow_step: {
    description: 'Adds or updates a step in a workflow. If step_order exists, updates it. If not provided, appends as next step.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow to add the step to',
        required: true,
      },
      action: {
        name: 'action',
        type: 'string',
        description: 'The action type for this step',
        required: true,
        enum: ['click', 'type', 'wait', 'scroll', 'nav', 'hover', 'extract', 'screenshot', 'upload_image'],
      },
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot. Required for click, type, hover, extract, scroll actions.',
        required: false,
      },
      action_value: {
        name: 'action_value',
        type: 'string',
        description: 'Value for the action (e.g., text to type, wait duration, URL for nav, URL for upload image)',
        required: false,
      },
      step_description: {
        name: 'step_description',
        type: 'string',
        description: 'A description of what this step does',
        required: false,
      },
      step_order: {
        name: 'step_order',
        type: 'number',
        description: 'The order of this step. If not provided, will be set to last + 1. If exists, will update.',
        required: false,
      },
    },
  },
  run_workflow: {
    description: 'Runs a workflow or a specific step. Executes actions with human-like timing and robust selector fallbacks. Use {{variable_name}} in action_value and pass runtime values via the variables parameter.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow to run',
        required: true,
      },
      step_order: {
        name: 'step_order',
        type: 'number',
        description: 'If provided, only this specific step will be executed',
        required: false,
      },
      variables: {
        name: 'variables',
        type: 'string',
        description: 'Key-value pairs to resolve {{variable_name}} placeholders in action_value fields. Example: {"username": "john", "password": "secret"}',
        required: false,
      },
    },
  },
  simulate_workflow: {
    description: 'Visually simulates a workflow without executing actions. Highlights target elements, moves the mouse naturally, and shows action labels so the user can preview workflow behavior.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow to simulate',
        required: true,
      },
      step_order: {
        name: 'step_order',
        type: 'number',
        description: 'If provided, only this specific step will be simulated',
        required: false,
      },
      pause_ms: {
        name: 'pause_ms',
        type: 'number',
        description: 'Pause duration per step in milliseconds (default: 2000)',
        required: false,
      },
    },
  },
  list_pages: {
    description: 'Get a list of pages  open in the browser.',
    category: 'Navigation automation',
    args: {},
  },
} as const;
