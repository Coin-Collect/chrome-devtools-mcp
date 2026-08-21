/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Commands} from './rockstarxCliDefinitions.js';

interface HelpCommand {
  name: string;
  description: string;
  requiredArgs?: string[];
}

const SERVICE_COMMANDS: HelpCommand[] = [
  {name: 'start', description: 'Start or restart the background service'},
  {name: 'status', description: 'Show the background service status'},
  {name: 'stop', description: 'Stop the background service'},
];

const SKILL_COMMANDS: HelpCommand[] = [
  {
    name: 'install_rockstar_skill',
    description: 'Copy the rockstar-cli skill into the current workspace',
  },
];

const CATEGORY_ORDER = [
  'Page inspection',
  'Human interaction',
  'Workflow management',
  'Workflow steps',
  'Workflow execution',
] as const;

const COMMAND_ORDER: Record<string, string[]> = {
  'Page inspection': ['list_pages', 'take_snapshot', 'take_screenshot'],
  'Human interaction': [
    'click_like_human',
    'type_like_human',
    'click_at_like_human',
    'drag_like_human',
  ],
  'Workflow management': [
    'list_workflows',
    'create_workflow',
    'update_workflow',
    'duplicate_workflow',
    'delete_workflow',
  ],
  'Workflow steps': [
    'add_workflow_step',
    'update_workflow_step',
    'delete_workflow_step',
  ],
  'Workflow execution': ['run_workflow', 'simulate_workflow'],
};

const GLOBAL_OPTIONS: HelpCommand[] = [
  {name: '--help', description: 'Show command-specific help'},
  {name: '--version', description: 'Show the installed version'},
  {
    name: '--output-format <md|json>',
    description: 'Select the tool output format (default: md)',
  },
  {
    name: '--response-timeout <ms>',
    description: 'Set daemon wait time; use 0 to disable it',
  },
];

function commandSignature(command: HelpCommand): string {
  const args = (command.requiredArgs ?? []).map(arg => `<${arg}>`).join(' ');
  return args ? `${command.name} ${args}` : command.name;
}

function wrapText(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) {
    lines.push(line);
  }
  return lines;
}

function renderCommandGroup(
  title: string,
  groupCommands: HelpCommand[],
  terminalWidth: number,
): string[] {
  const lines = [`${title}:`];
  const signatures = groupCommands.map(commandSignature);
  const longestSignature = Math.max(
    ...signatures.map(signature => signature.length),
  );

  if (terminalWidth < 72 || longestSignature + 32 > terminalWidth) {
    for (let index = 0; index < groupCommands.length; index++) {
      lines.push(`  ${signatures[index]}`);
      for (const descriptionLine of wrapText(
        groupCommands[index].description,
        terminalWidth - 6,
      )) {
        lines.push(`    ${descriptionLine}`);
      }
    }
    return lines;
  }

  const commandWidth = Math.max(28, longestSignature);
  const descriptionWidth = Math.max(24, terminalWidth - commandWidth - 4);

  for (let index = 0; index < groupCommands.length; index++) {
    const descriptionLines = wrapText(
      groupCommands[index].description,
      descriptionWidth,
    );
    lines.push(
      `  ${signatures[index].padEnd(commandWidth)}  ${descriptionLines[0]}`,
    );
    for (const descriptionLine of descriptionLines.slice(1)) {
      lines.push(`  ${' '.repeat(commandWidth)}  ${descriptionLine}`);
    }
  }

  return lines;
}

export function renderRockstarHelp(
  commands: Commands,
  requestedWidth = 100,
): string {
  const terminalWidth = Math.max(48, Math.min(requestedWidth, 120));
  const groupedCommands = new Map<string, HelpCommand[]>();

  for (const [name, definition] of Object.entries(commands)) {
    const group = groupedCommands.get(definition.category) ?? [];
    group.push({
      name,
      description: definition.description,
      requiredArgs: Object.values(definition.args)
        .filter(arg => arg.required)
        .map(arg => arg.name),
    });
    groupedCommands.set(definition.category, group);
  }

  const lines = [
    'Rockstar CLI',
    'Human-like browser automation and reusable workflows.',
    '',
    'Usage:',
    '  rockstar <command> [arguments] [options]',
    '  rockstar <command> --help',
    '',
    'Quick start:',
    '  rockstar take_snapshot',
    '  rockstar click_like_human <uid>',
    '  rockstar run_workflow <workflow_id>',
    '',
    ...renderCommandGroup('Service', SERVICE_COMMANDS, terminalWidth),
    '',
    ...renderCommandGroup('Skill management', SKILL_COMMANDS, terminalWidth),
  ];

  for (const category of CATEGORY_ORDER) {
    const categoryCommands = groupedCommands.get(category);
    if (!categoryCommands?.length) {
      continue;
    }
    const preferredOrder = COMMAND_ORDER[category];
    categoryCommands.sort(
      (left, right) =>
        preferredOrder.indexOf(left.name) - preferredOrder.indexOf(right.name),
    );
    lines.push('', ...renderCommandGroup(category, categoryCommands, terminalWidth));
  }

  lines.push(
    '',
    ...renderCommandGroup('Global options', GLOBAL_OPTIONS, terminalWidth),
    '',
    'Run `rockstar <command> --help` to see every argument and option.',
  );

  return lines.join('\n');
}
