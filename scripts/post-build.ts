/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const BUILD_DIR = path.join(process.cwd(), 'build');

/**
 * Writes content to a file.
 * @param filePath The path to the file.
 * @param content The content to write.
 */
function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function main(): Promise<void> {
  const devtoolsThirdPartyPath =
    'node_modules/chrome-devtools-frontend/front_end/third_party';
  const devtoolsFrontEndCorePath =
    'node_modules/chrome-devtools-frontend/front_end/core';

  // Create i18n mock
  const i18nDir = path.join(BUILD_DIR, devtoolsFrontEndCorePath, 'i18n');
  fs.mkdirSync(i18nDir, {recursive: true});
  const localesFile = path.join(i18nDir, 'locales.js');
  const localesContent = `
export const LOCALES = [
  'en-US',
];

export const BUNDLED_LOCALES = [
  'en-US',
];

export const DEFAULT_LOCALE = 'en-US';

export const REMOTE_FETCH_PATTERN = '@HOST@/remote/serve_file/@VERSION@/core/i18n/locales/@LOCALE@.json';

export const LOCAL_FETCH_PATTERN = './locales/@LOCALE@.json';`;
  writeFile(localesFile, localesContent);

  // Create codemirror.next mock.
  const codeMirrorDir = path.join(
    BUILD_DIR,
    devtoolsThirdPartyPath,
    'codemirror.next',
  );
  fs.mkdirSync(codeMirrorDir, {recursive: true});
  const codeMirrorFile = path.join(codeMirrorDir, 'codemirror.next.js');
  const codeMirrorContent = `export default {}`;
  writeFile(codeMirrorFile, codeMirrorContent);

  // Create root mock
  const rootDir = path.join(BUILD_DIR, devtoolsFrontEndCorePath, 'root');
  fs.mkdirSync(rootDir, {recursive: true});
  const runtimeFile = path.join(rootDir, 'Runtime.js');
  const runtimeContent = `
export function getChromeVersion() { return ''; };
export const hostConfig = {};
export const Runtime = {
  isDescriptorEnabled: () => true,
  queryParam: () => null,
}
export const experiments = {
  isEnabled: () => false,
}
export const ExperimentName = {
  ALL: '*',
  CAPTURE_NODE_CREATION_STACKS: 'capture-node-creation-stacks',
  LIVE_HEAP_PROFILE: 'live-heap-profile',
  PROTOCOL_MONITOR: 'protocol-monitor',
  SAMPLING_HEAP_PROFILER_TIMELINE: 'sampling-heap-profiler-timeline',
  SHOW_OPTION_TO_EXPOSE_INTERNALS_IN_HEAP_SNAPSHOT: 'show-option-to-expose-internals-in-heap-snapshot',
  TIMELINE_INVALIDATION_TRACKING: 'timeline-invalidation-tracking',
  TIMELINE_SHOW_ALL_EVENTS: 'timeline-show-all-events',
  TIMELINE_V8_RUNTIME_CALL_STATS: 'timeline-v8-runtime-call-stats',
  APCA: 'apca',
  FONT_EDITOR: 'font-editor',
  FULL_ACCESSIBILITY_TREE: 'full-accessibility-tree',
  CONTRAST_ISSUES: 'contrast-issues',
  EXPERIMENTAL_COOKIE_FEATURES: 'experimental-cookie-features',
  INSTRUMENTATION_BREAKPOINTS: 'instrumentation-breakpoints',
  AUTHORED_DEPLOYED_GROUPING: 'authored-deployed-grouping',
  JUST_MY_CODE: 'just-my-code',
  USE_SOURCE_MAP_SCOPES: 'use-source-map-scopes',
  TIMELINE_SHOW_POST_MESSAGE_EVENTS: 'timeline-show-postmessage-events',
  TIMELINE_DEBUG_MODE: 'timeline-debug-mode',
}
  `;
  writeFile(runtimeFile, runtimeContent);

  copyDevToolsDescriptionFiles();
  await copyProjectToHomedir();
}

async function copyProjectToHomedir() {
  const homeDir = os.homedir();
  const destDir = path.join(homeDir, 'rockstarx');
  console.log(`Copying project to ${destDir}...`);
  
  try {
    fs.cpSync(process.cwd(), destDir, {
      recursive: true,
      force: true,
      filter: (src) => {
        const basename = path.basename(src);
        // Exclude .git to avoid copying version control history
        if (basename === '.git') return false;
        // Includes node_modules 
        return true;
      }
    });
    console.log(`Project copied to ${destDir} successfully.`);

    const whitelistPath = path.join(destDir, 'whitelist.json');
    fs.writeFileSync(whitelistPath, JSON.stringify(["sapienx.app"], null, 2), 'utf-8');
    console.log('Created whitelist.json with sapienx.app');

    const envPath = path.join(destDir, '.env');
    if (!fs.existsSync(envPath)) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

      console.log('\\n--- Rockstarx Setup ---');
      const supabaseUrl = await question('Please enter your SUPABASE_URL: ');
      const supabaseKey = await question('Please enter your SUPABASE_KEY: ');
      
      const envContent = \`SUPABASE_URL=\${supabaseUrl}\\nSUPABASE_KEY=\${supabaseKey}\\n\`;
      fs.writeFileSync(envPath, envContent, 'utf-8');
      rl.close();
      console.log('.env file created successfully in rockstarx folder.\\n');
    }

    console.log('Linking package globally...');
    execSync('npm link', { cwd: destDir, stdio: 'inherit' });
    console.log('Rockstar CLI is now available globally!');
  } catch (error) {
    console.error(`Failed to copy project to homedir:`, error);
  }
}

function copyDevToolsDescriptionFiles() {
  const devtoolsIssuesDescriptionPath =
    'node_modules/chrome-devtools-frontend/front_end/models/issues_manager/descriptions';
  const sourceDir = path.join(process.cwd(), devtoolsIssuesDescriptionPath);
  const destDir = path.join(
    BUILD_DIR,
    'src',
    'third_party',
    'issue-descriptions',
  );
  fs.cpSync(sourceDir, destDir, {recursive: true});
}

main().catch(console.error);
