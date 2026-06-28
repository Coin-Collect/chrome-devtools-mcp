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
    description: 'Types text into an element with fully realistic human behavior: scrolls into view, moves the cursor naturally to the element, clicks to focus with natural mousedown/mouseup, pauses briefly, then types each character using keyboard.down/up with natural hold durations, inter-key delays matching ~55 WPM, Shift key handling for uppercase, and occasional typos that are corrected with Backspace. If uid is not provided, types into the currently focused element. NOTE: Unless otherwise specified, prefer this tool over the standard type tool.',
    category: 'Input automation',
    args: {
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot. If not provided, types into the currently focused element.',
        required: false,
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
  update_workflow: {
    description: 'Updates an existing workflow by ID. Only provided fields are changed.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow to update',
        required: true,
      },
      title: {
        name: 'title',
        type: 'string',
        description: 'The new title of the workflow',
        required: false,
      },
      website_url: {
        name: 'website_url',
        type: 'string',
        description: 'The new target website URL for the workflow',
        required: false,
      },
      description: {
        name: 'description',
        type: 'string',
        description: 'The new description of what the workflow does',
        required: false,
      },
      success_criteria: {
        name: 'success_criteria',
        type: 'string',
        description: 'The new criteria to determine if the workflow succeeded',
        required: false,
      },
      status: {
        name: 'status',
        type: 'string',
        description: 'The new workflow status',
        required: false,
      },
    },
  },
  duplicate_workflow: {
    description: 'Duplicates an existing workflow by ID, including all of its steps.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow to duplicate',
        required: true,
      },
      title: {
        name: 'title',
        type: 'string',
        description: 'Optional title for the duplicated workflow. Defaults to "Copy of <original title>".',
        required: false,
      },
    },
  },
  update_workflow_step: {
    description: 'Updates a single workflow step by workflow ID and step order. Only provided fields are changed.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow that contains the step',
        required: true,
      },
      step_order: {
        name: 'step_order',
        type: 'number',
        description: 'The step order of the step to update',
        required: true,
      },
      action: {
        name: 'action',
        type: 'string',
        description: 'The new action type for this step',
        required: false,
        enum: ['click', 'choice_click', 'type', 'wait', 'scroll', 'nav', 'hover', 'extract', 'screenshot', 'upload_image', 'run_workflow'],
      },
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot. Required when updating to an element-based action or when refreshing selectors.',
        required: false,
      },
      choices: {
        name: 'choices',
        type: 'string',
        description: 'For choice_click actions, a JSON object mapping choice keys to element uids. Example: {"basic":"uid-1","pro":"uid-2"}.',
        required: false,
      },
      action_value: {
        name: 'action_value',
        type: 'string',
        description: 'The new value for the action (e.g., text to type, wait duration, URL for nav, target workflow ID for run_workflow, URL for upload image, or choice key/template for choice_click)',
        required: false,
      },
      step_description: {
        name: 'step_description',
        type: 'string',
        description: 'The new description for this step',
        required: false,
      },
    },
  },
  delete_workflow_step: {
    description: 'Deletes a workflow step by workflow ID and step order, then closes the gap in the remaining step order.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow that contains the step',
        required: true,
      },
      step_order: {
        name: 'step_order',
        type: 'number',
        description: 'The order of the step to delete',
        required: true,
      },
    },
  },
  delete_workflow: {
    description: 'Deletes a workflow by ID and removes its workflow steps first.',
    category: 'Input automation',
    args: {
      workflow_id: {
        name: 'workflow_id',
        type: 'number',
        description: 'The ID of the workflow to delete',
        required: true,
      },
    },
  },
  list_workflows: {
    description: 'Lists workflows from the database, optionally filtered by website URL. Steps are hidden by default and can be included on demand.',
    category: 'Input automation',
    args: {
      website_url: {
        name: 'website_url',
        type: 'string',
        description: 'Optional website URL to filter workflows by. Matches the stored workflow website_url value.',
        required: false,
      },
      show_steps: {
        name: 'show_steps',
        type: 'boolean',
        description: 'Whether to include workflow steps in the listing. Default is false.',
        required: false,
      },
    },
  },
  add_workflow_step: {
    description: 'Adds, inserts, or updates a workflow step. Use insert_at to insert a new step and shift later steps forward.',
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
        enum: ['click', 'choice_click', 'type', 'wait', 'scroll', 'nav', 'hover', 'extract', 'screenshot', 'upload_image', 'run_workflow'],
      },
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot. Required for click, type, hover, extract, scroll actions.',
        required: false,
      },
      choices: {
        name: 'choices',
        type: 'string',
        description: 'For choice_click actions, a JSON object mapping choice keys to element uids. Example: {"basic":"uid-1","pro":"uid-2"}.',
        required: false,
      },
      action_value: {
        name: 'action_value',
        type: 'string',
        description: 'Value for the action (e.g., text to type, wait duration, URL for nav, target workflow ID for run_workflow, URL for upload image, or choice key/template for choice_click)',
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
      insert_at: {
        name: 'insert_at',
        type: 'number',
        description: 'Insert a new step at this order and shift this and all later steps forward. Cannot be used with step_order.',
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
  take_screenshot: {
    description: 'Take a screenshot of the page or element.',
    category: 'Debugging',
    args: {
      format: {
        name: 'format',
        type: 'string',
        description: 'Type of format to save the screenshot as. Default is "png"',
        required: false,
        enum: ['png', 'jpeg', 'webp'],
        default: 'png',
      },
      quality: {
        name: 'quality',
        type: 'number',
        description: 'Compression quality for JPEG and WebP formats (0-100). Higher values mean better quality but larger file sizes. Ignored for PNG format.',
        required: false,
      },
      uid: {
        name: 'uid',
        type: 'string',
        description: 'The uid of an element on the page from the page content snapshot. If omitted, takes a page screenshot.',
        required: false,
      },
      fullPage: {
        name: 'fullPage',
        type: 'boolean',
        description: 'If set to true takes a screenshot of the full page instead of the currently visible viewport. Incompatible with uid.',
        required: false,
      },
      filePath: {
        name: 'filePath',
        type: 'string',
        description: 'The absolute path, or a path relative to the current working directory, to save the screenshot to instead of attaching it to the response.',
        required: false,
      },
    },
  },
  click_at_like_human: {
    description: 'Clicks at the provided coordinates with fully realistic human behavior: moves the cursor along a natural Bezier curve path from its current position to the target coordinates, hovers briefly, then performs a mousedown/mouseup with natural hold timing. A symbolic cursor is displayed during the interaction. NOTE: Unless otherwise specified, prefer this tool over the standard click_at tool.',
    category: 'Input automation',
    args: {
      x: {
        name: 'x',
        type: 'number',
        description: 'The x coordinate',
        required: true,
      },
      y: {
        name: 'y',
        type: 'number',
        description: 'The y coordinate',
        required: true,
      },
    },
  },
  drag_like_human: {
    description: 'Drags an element onto another element with fully realistic human behavior: scrolls the source element into view, moves the cursor naturally to it, picks it up with a natural mousedown hold, then moves the cursor along a Bezier curve to the drop target and releases with mouseup. Includes pickup pause, natural trajectory, and drop settling. NOTE: Unless otherwise specified, prefer this tool over the standard drag tool.',
    category: 'Input automation',
    args: {
      from_uid: {
        name: 'from_uid',
        type: 'string',
        description: 'The uid of the element to drag',
        required: true,
      },
      to_uid: {
        name: 'to_uid',
        type: 'string',
        description: 'The uid of the element to drop into',
        required: true,
      },
    },
  },
  list_pages: {
    description: 'Get a list of pages  open in the browser.',
    category: 'Navigation automation',
    args: {},
  },
} as const;
