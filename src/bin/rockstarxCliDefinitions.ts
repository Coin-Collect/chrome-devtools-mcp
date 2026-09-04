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
    description: 'Inspect the selected page and list element UIDs',
    category: 'Page inspection',
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
          'A file name or relative path within the controlled output directory to save the snapshot to instead of attaching it to the response.',
        required: false,
      },
      overwrite: {
        name: 'overwrite',
        type: 'boolean',
        description:
          'Whether to replace an existing file at filePath. Default is false.',
        required: false,
      },
    },
  },
  click_like_human: {
    description: 'Click an element naturally using its snapshot UID',
    category: 'Human interaction',
    args: {
      uid: {
        name: 'uid',
        type: 'string',
        description:
          'The uid of an element on the page from the page content snapshot',
        required: true,
      },
    },
  },
  type_like_human: {
    description: 'Type text naturally into a UID or the focused element',
    category: 'Human interaction',
    args: {
      uid: {
        name: 'uid',
        type: 'string',
        description:
          'The uid of an element on the page from the page content snapshot. If not provided, types into the currently focused element.',
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
    description: 'Create a reusable workflow',
    category: 'Workflow management',
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
    description: 'Update selected fields of a workflow',
    category: 'Workflow management',
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
    description: 'Duplicate a workflow and all of its steps',
    category: 'Workflow management',
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
        description:
          'Optional title for the duplicated workflow. Defaults to "Copy of <original title>".',
        required: false,
      },
    },
  },
  update_workflow_step: {
    description: 'Update selected fields of one workflow step',
    category: 'Workflow steps',
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
        enum: [
          'click',
          'choice_click',
          'type',
          'wait',
          'scroll',
          'nav',
          'hover',
          'extract',
          'screenshot',
          'upload_image',
          'run_workflow',
        ],
      },
      uid: {
        name: 'uid',
        type: 'string',
        description:
          'The uid of an element on the page from the page content snapshot. Required when updating to an element-based action or when refreshing selectors.',
        required: false,
      },
      choices: {
        name: 'choices',
        type: 'string',
        description:
          'For choice_click actions, a JSON object mapping choice keys to element uids. Example: {"basic":"uid-1","pro":"uid-2"}.',
        required: false,
      },
      action_value: {
        name: 'action_value',
        type: 'string',
        description:
          'The new value for the action (e.g., text to type, wait duration, URL for nav, target workflow ID for run_workflow, URL for upload image, or choice key/template for choice_click)',
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
    description: 'Delete a step and reorder the remaining steps',
    category: 'Workflow steps',
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
    description: 'Delete a workflow and all of its steps',
    category: 'Workflow management',
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
    description:
      'List workflows with filters, pagination, sorting, and optional step details',
    category: 'Workflow management',
    args: {
      website_url: {
        name: 'website_url',
        type: 'string',
        description:
          'Optional website URL to filter workflows by. Matches the stored workflow website_url value.',
        required: false,
      },
      website_url_match: {
        name: 'website_url_match',
        type: 'string',
        description: 'How to match website_url: exact (default) or hostname.',
        required: false,
        enum: ['exact', 'hostname'],
      },
      status: {
        name: 'status',
        type: 'string',
        description: 'Optional exact workflow status filter.',
        required: false,
      },
      title_contains: {
        name: 'title_contains',
        type: 'string',
        description:
          'Optional case-insensitive substring filter for workflow titles.',
        required: false,
      },
      action: {
        name: 'action',
        type: 'string',
        description:
          'Optional action filter; returns workflows containing that action.',
        required: false,
        enum: [
          'click',
          'choice_click',
          'type',
          'wait',
          'scroll',
          'nav',
          'hover',
          'extract',
          'screenshot',
          'upload_image',
          'run_workflow',
        ],
      },
      show_steps: {
        name: 'show_steps',
        type: 'boolean',
        description:
          'Whether to include workflow steps in the listing. Default is false.',
        required: false,
      },
      show_selector_strategies: {
        name: 'show_selector_strategies',
        type: 'boolean',
        description:
          'Include every selector strategy, frame selector, and target signature. Implies show_steps.',
        required: false,
      },
      limit: {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of workflows to return.',
        required: false,
      },
      offset: {
        name: 'offset',
        type: 'number',
        description:
          'Number of workflows to skip before returning results. Default is 0.',
        required: false,
      },
      max_steps: {
        name: 'max_steps',
        type: 'number',
        description:
          'Maximum number of steps to show per workflow when details are enabled.',
        required: false,
      },
      sort_by: {
        name: 'sort_by',
        type: 'string',
        description: 'Workflow field used for sorting. Default is created_at.',
        required: false,
        enum: ['created_at', 'title', 'status', 'website_url', 'id'],
      },
      sort_order: {
        name: 'sort_order',
        type: 'string',
        description: 'Sort direction. Default is desc.',
        required: false,
        enum: ['asc', 'desc'],
      },
    },
  },
  add_workflow_step: {
    description: 'Add or insert a new step into a workflow',
    category: 'Workflow steps',
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
        enum: [
          'click',
          'choice_click',
          'type',
          'wait',
          'scroll',
          'nav',
          'hover',
          'extract',
          'screenshot',
          'upload_image',
          'run_workflow',
        ],
      },
      uid: {
        name: 'uid',
        type: 'string',
        description:
          'The uid of an element on the page from the page content snapshot. Required for click, type, hover, extract, scroll actions.',
        required: false,
      },
      choices: {
        name: 'choices',
        type: 'string',
        description:
          'For choice_click actions, a JSON object mapping choice keys to element uids. Example: {"basic":"uid-1","pro":"uid-2"}.',
        required: false,
      },
      action_value: {
        name: 'action_value',
        type: 'string',
        description:
          'Value for the action (e.g., text to type, wait duration, URL for nav, target workflow ID for run_workflow, URL for upload image, or choice key/template for choice_click)',
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
        description:
          'The order of this new step. If not provided, it will be set to last + 1. Fails if already in use; use update_workflow_step to modify an existing step.',
        required: false,
      },
      insert_at: {
        name: 'insert_at',
        type: 'number',
        description:
          'Insert a new step at this order and shift this and all later steps forward. Cannot be used with step_order.',
        required: false,
      },
    },
  },
  run_workflow: {
    description: 'Run a workflow or one selected step',
    category: 'Workflow execution',
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
        description:
          'Key-value pairs to resolve {{variable_name}} placeholders in action_value fields. Example: {"username": "john", "password": "secret"}',
        required: false,
      },
    },
  },
  simulate_workflow: {
    description: 'Preview workflow actions without executing them',
    category: 'Workflow execution',
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
    description: 'Capture the selected page or one element',
    category: 'Page inspection',
    args: {
      format: {
        name: 'format',
        type: 'string',
        description:
          'Type of format to save the screenshot as. Default is "png"',
        required: false,
        enum: ['png', 'jpeg', 'webp'],
        default: 'png',
      },
      quality: {
        name: 'quality',
        type: 'number',
        description:
          'Compression quality for JPEG and WebP formats (0-100). Higher values mean better quality but larger file sizes. Ignored for PNG format.',
        required: false,
      },
      uid: {
        name: 'uid',
        type: 'string',
        description:
          'The uid of an element on the page from the page content snapshot. If omitted, takes a page screenshot.',
        required: false,
      },
      fullPage: {
        name: 'fullPage',
        type: 'boolean',
        description:
          'If set to true takes a screenshot of the full page instead of the currently visible viewport. Incompatible with uid.',
        required: false,
      },
      filePath: {
        name: 'filePath',
        type: 'string',
        description:
          'A file name or relative path within the controlled output directory to save the screenshot to instead of attaching it to the response.',
        required: false,
      },
      overwrite: {
        name: 'overwrite',
        type: 'boolean',
        description:
          'Whether to replace an existing file at filePath. Default is false.',
        required: false,
      },
    },
  },
  click_at_like_human: {
    description: 'Click screen coordinates with natural mouse movement',
    category: 'Human interaction',
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
    description: 'Drag one UID onto another with natural mouse movement',
    category: 'Human interaction',
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
    description: 'List open browser pages and the selected page',
    category: 'Page inspection',
    args: {},
  },
} as const;
