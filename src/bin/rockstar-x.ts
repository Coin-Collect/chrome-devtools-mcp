#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

process.title = 'rockstar';

import process from 'node:process';

import type {Options, PositionalOptions} from 'yargs';

import {
  startDaemon,
  stopDaemon,
  sendCommand,
  handleResponse,
} from '../daemon/client.js';
import {
  createUnavailableDaemonStatus,
  formatDaemonStatus,
  normalizeDaemonStatus,
} from '../daemon/status.js';
import {isDaemonRunning, serializeArgs} from '../daemon/utils.js';
import {logDisclaimers} from '../index.js';
import {hideBin, yargs, type CallToolResult} from '../third_party/index.js';
import type {Response as ToolResponse} from '../tools/ToolDefinition.js';
import {VERSION} from '../version.js';

import {cliOptions, parseArguments} from './chrome-devtools-mcp-cli-options.js';
import {commands} from './rockstarxCliDefinitions.js';
import {renderRockstarHelp} from './rockstarxHelp.js';
import {copyRockstarSkillToAgents} from './rockstarxSkill.js';

const rawArgs = hideBin(process.argv);

async function start(args: string[]) {
  const combinedArgs = [...args, ...defaultArgs];
  await startDaemon(combinedArgs);
  logDisclaimers(parseArguments(VERSION, combinedArgs));
}

const defaultArgs = [
  '--viaCli',
  '--experimentalStructuredContent',
  '--no-performance-crux',
  '--no-usage-statistics',
];

const DEFAULT_RESPONSE_TIMEOUT = 60_000;
// Workflow duration is user-defined through waits, steps, and nested workflows.
const WORKFLOW_RESPONSE_TIMEOUT = 0;
const DAEMON_RESPONSE_GRACE_PERIOD = 5_000;

async function runListWorkflowsWithoutDaemon(
  commandArgs: Record<string, unknown>,
  outputFormat: 'md' | 'json',
): Promise<void> {
  const {listWorkflows} = await import('../tools/workflow.js');
  const responseLines: string[] = [];
  let structuredContent: Record<string, unknown> | undefined;
  const response = {
    appendResponseLine(value: string) {
      responseLines.push(value);
    },
    appendUntrustedPageContent(value: string, _source: string) {
      responseLines.push(value);
    },
    setStructuredContent(value: Record<string, unknown>) {
      structuredContent = value;
    },
  } as ToolResponse;

  await listWorkflows.handler(
    {params: commandArgs} as Parameters<typeof listWorkflows.handler>[0],
    response,
    undefined as never,
  );

  if (outputFormat === 'json') {
    console.log(
      JSON.stringify(
        structuredContent ?? {message: responseLines.join('\n')},
      ),
    );
  } else {
    console.log(responseLines.join('\n'));
  }
}

if (
  rawArgs.length === 0 ||
  (rawArgs.length === 1 && ['--help', '-h'].includes(rawArgs[0]))
) {
  console.log(renderRockstarHelp(commands, process.stdout.columns || 100));
  process.exit(0);
}

function parseJsonObjectArg(argName: string, value: unknown): unknown {
  if (
    typeof value !== 'string' ||
    !['choices', 'variables'].includes(argName)
  ) {
    return value;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch {
    // Let the tool schema produce the final validation error.
  }

  return value;
}

const startCliOptions = {
  ...cliOptions,
} as Partial<typeof cliOptions>;

// Not supported in CLI on purpose.
delete startCliOptions.autoConnect;
// Missing CLI serialization.
delete startCliOptions.viewport;
// CLI is generated based on the default tool definitions. To enable conditional
// tools, they need to be enabled during CLI generation.
delete startCliOptions.experimentalPageIdRouting;
delete startCliOptions.experimentalVision;
delete startCliOptions.experimentalInteropTools;
delete startCliOptions.experimentalScreencast;
delete startCliOptions.categoryEmulation;
delete startCliOptions.categoryPerformance;
delete startCliOptions.categoryNetwork;
delete startCliOptions.categoryExtensions;
// Always on in CLI.
delete startCliOptions.experimentalStructuredContent;
// Change the defaults.
if (!('default' in cliOptions.headless)) {
  throw new Error('headless cli option unexpectedly does not have a default');
}
if ('default' in cliOptions.isolated) {
  throw new Error('isolated cli option unexpectedly has a default');
}
startCliOptions.headless!.default = true;
startCliOptions.isolated!.description =
  'If specified, creates a temporary user-data-dir that is automatically cleaned up after the browser is closed. Defaults to true unless userDataDir is provided.';

const y = yargs(hideBin(process.argv))
  .scriptName('rockstar')
  .showHelpOnFail(true)
  .usage('rockstar <command> [...args] --flags')
  .usage(`Run 'rockstar <command> --help' for help on the specific command.`)
  .demandCommand()
  .recommendCommands()
  .version(VERSION)
  .strict()
  .help(true)
  .wrap(120);

y.command(
  'start',
  'Start or restart chrome-devtools-mcp',
  y =>
    y
      .options(startCliOptions)
      .example(
        '$0 start --browserUrl http://localhost:9222',
        'Start the server connecting to an existing browser',
      )
      .strict(),
  async argv => {
    if (isDaemonRunning()) {
      await stopDaemon();
    }
    // Defaults but we do not want to affect the yargs conflict resolution.
    if (argv.isolated === undefined && argv.userDataDir === undefined) {
      argv.isolated = true;
    }
    if (argv.headless === undefined) {
      argv.headless = true;
    }
    const args = serializeArgs(cliOptions, argv);
    await start(args);
    process.exit(0);
  },
).strict(); // Re-enable strict validation for other commands; this is applied to the yargs instance itself

y.command(
  'status',
  'Show daemon health, uptime, version, and configuration',
  y =>
    y
      .option('output-format', {
        choices: ['md', 'json'],
        default: 'md',
      })
      .strict(),
  async argv => {
    const outputFormat = argv['output-format'] as 'json' | 'md';

    if (!isDaemonRunning()) {
      console.log(
        formatDaemonStatus(createUnavailableDaemonStatus(), outputFormat),
      );
      process.exit(1);
    }

    try {
      const response = await sendCommand({
        method: 'status',
      });
      if (!response.success) {
        throw new Error(String(response.error));
      }

      const status = normalizeDaemonStatus(JSON.parse(response.result));
      console.log(formatDaemonStatus(status, outputFormat));
      process.exit(status.healthy ? 0 : 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (outputFormat === 'json') {
        console.error(
          JSON.stringify({running: false, healthy: false, error: message}),
        );
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }
  },
);

y.command('stop', 'Stop chrome-devtools-mcp if any', async () => {
  if (!isDaemonRunning()) {
    process.exit(0);
  }
  await stopDaemon();
  process.exit(0);
});

y.command(
  'install_rockstar_skill',
  'Copy the rockstar-cli skill from ~/rockstarx into the current workspace',
  y => y.strict(),
  () => {
    try {
      const destination = copyRockstarSkillToAgents();
      console.log(`Copied rockstar-cli skill to ${destination}`);
    } catch (error) {
      console.error('Failed to copy rockstar-cli skill:', error);
      process.exit(1);
    }
  },
)
  .alias({copy_rockstar_skill: 'install_rockstar_skill'})
  .strict();

for (const [commandName, commandDef] of Object.entries(commands)) {
  const args = commandDef.args;
  const requiredArgNames = Object.keys(args).filter(
    name => args[name].required,
  );

  const optionalArgNames = Object.keys(args).filter(
    name => !args[name].required,
  );

  let commandStr = commandName;
  for (const arg of requiredArgNames) {
    commandStr += ` <${arg}>`;
  }

  for (const arg of optionalArgNames) {
    commandStr += ` [--${arg}]`;
  }

  y.command(
    commandStr,
    commandDef.description,
    y => {
      y.option('output-format', {
        choices: ['md', 'json'],
        default: 'md',
      });
      y.option('response-timeout', {
        type: 'number',
        default: ['run_workflow', 'simulate_workflow'].includes(commandName)
          ? WORKFLOW_RESPONSE_TIMEOUT
          : DEFAULT_RESPONSE_TIMEOUT,
        describe:
          'Maximum time in milliseconds to wait for the daemon response. Set to 0 to disable the client-side timeout.',
      });
      for (const [argName, opt] of Object.entries(args)) {
        const type =
          opt.type === 'integer' || opt.type === 'number'
            ? 'number'
            : opt.type === 'boolean'
              ? 'boolean'
              : opt.type === 'array'
                ? 'array'
                : 'string';

        if (opt.required) {
          const options: PositionalOptions = {
            describe: opt.description,
            type: type as PositionalOptions['type'],
          };
          if (opt.default !== undefined) {
            options.default = opt.default;
          }
          if (opt.enum) {
            options.choices = opt.enum as Array<string | number>;
          }
          y.positional(argName, options);
        } else {
          const options: Options = {
            describe: opt.description,
            type: type as Options['type'],
          };
          if (opt.default !== undefined) {
            options.default = opt.default;
          }
          if (opt.enum) {
            options.choices = opt.enum as Array<string | number>;
          }
          y.option(argName, options);
        }
      }
    },
    async argv => {
      try {
        const commandArgs: Record<string, unknown> = {};
        for (const argName of Object.keys(args)) {
          if (argName in argv) {
            commandArgs[argName] = parseJsonObjectArg(argName, argv[argName]);
          }
        }

        if (commandName === 'list_workflows') {
          await runListWorkflowsWithoutDaemon(
            commandArgs,
            argv['output-format'] as 'json' | 'md',
          );
          return;
        }

        if (!isDaemonRunning()) {
          await start([]);
        }

        const responseTimeout = argv['response-timeout'] as number;
        if (!Number.isFinite(responseTimeout) || responseTimeout < 0) {
          throw new Error('Response timeout must be a non-negative number');
        }
        const response = await sendCommand(
          {
            method: 'invoke_tool',
            tool: commandName,
            args: commandArgs,
            timeoutMs: responseTimeout,
          },
          responseTimeout === 0
            ? 0
            : responseTimeout + DAEMON_RESPONSE_GRACE_PERIOD,
        );

        if (response.success) {
          console.log(
            await handleResponse(
              JSON.parse(response.result) as unknown as CallToolResult,
              argv['output-format'] as 'json' | 'md',
            ),
          );
        } else {
          console.error('Error:', response.error);
          process.exit(1);
        }
      } catch (error) {
        console.error('Failed to execute command:', error);
        process.exit(1);
      }
    },
  );
}

await y.parse();
