/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ParsedArguments} from '../bin/chrome-devtools-mcp-cli-options.js';

// import * as consoleTools from './console.js';
// import * as emulationTools from './emulation.js';
// import * as extensionTools from './extensions.js';
// import * as inPageTools from './inPage.js';
// import * as inputTools from './input.js';
// import * as lighthouseTools from './lighthouse.js';
// import * as memoryTools from './memory.js';
// import * as networkTools from './network.js';
// import * as pagesTools from './pages.js';
// import * as performanceTools from './performance.js';
// import * as screencastTools from './screencast.js';
// import * as screenshotTools from './screenshot.js';
// import * as scriptTools from './script.js';
// import * as slimTools from './slim/tools.js';
// import * as snapshotTools from './snapshot.js';
import {
  addUrlToWhitelist,
  addWorkflowStep,
  clickAtLikeHuman,
  clickLikeHuman,
  createWorkflow,
  dragLikeHuman,
  listWorkflows,
  runWorkflow,
  simulateWorkflow,
  typeLikeHuman,
} from './workflow.js';
import type {DefinedPageTool, ToolDefinition} from './ToolDefinition.js';

export const createTools = (args: ParsedArguments) => {
  const rawTools = [
    createWorkflow,
    listWorkflows,
    addWorkflowStep,
    addUrlToWhitelist,
    runWorkflow,
    simulateWorkflow,
    clickLikeHuman,
    typeLikeHuman,
    clickAtLikeHuman,
    dragLikeHuman,
  ];

  const tools = [...rawTools] as unknown as Array<ToolDefinition | DefinedPageTool>;
  tools.sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  return tools;
};
