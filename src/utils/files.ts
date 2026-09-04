/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface SaveFileOptions {
  overwrite?: boolean;
}

const OUTPUT_DIRECTORY_NAME = 'output';

export function getOutputDirectory(): string {
  return path.resolve(process.cwd(), OUTPUT_DIRECTORY_NAME);
}

function resolveOutputFilePath(filename: string): {
  outputDirectory: string;
  filePath: string;
} {
  const outputDirectory = getOutputDirectory();
  const filePath = path.isAbsolute(filename)
    ? path.resolve(filename)
    : path.resolve(outputDirectory, filename);
  const relativePath = path.relative(outputDirectory, filePath);

  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `File path must stay within the controlled output directory: ${outputDirectory}`,
    );
  }

  return {outputDirectory, filePath};
}

async function assertNotSymlink(filePath: string): Promise<void> {
  const stats = await fs.lstat(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to write through symbolic link: ${filePath}`);
  }
}

async function ensureSafeOutputDirectory(
  outputDirectory: string,
  targetDirectory: string,
): Promise<void> {
  await fs.mkdir(outputDirectory, {recursive: true});
  await assertNotSymlink(outputDirectory);

  const pathSegments = path
    .relative(outputDirectory, targetDirectory)
    .split(path.sep)
    .filter(Boolean);
  let currentDirectory = outputDirectory;

  for (const segment of pathSegments) {
    currentDirectory = path.join(currentDirectory, segment);
    await fs.mkdir(currentDirectory, {recursive: true});
    await assertNotSymlink(currentDirectory);
  }
}

async function lstatIfExists(
  filePath: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveOutputFile(
  data: Uint8Array<ArrayBufferLike>,
  filename: string,
  options: SaveFileOptions = {},
): Promise<{filename: string}> {
  const {outputDirectory, filePath} = resolveOutputFilePath(filename);
  await ensureSafeOutputDirectory(outputDirectory, path.dirname(filePath));

  const existingFile = await lstatIfExists(filePath);
  if (existingFile?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symbolic link: ${filePath}`);
  }
  if (existingFile && !options.overwrite) {
    throw new Error(
      `Refusing to overwrite existing file: ${filePath}. Set overwrite to true to replace it.`,
    );
  }

  await fs.writeFile(filePath, data, {flag: options.overwrite ? 'w' : 'wx'});
  return {filename: filePath};
}

export async function saveTemporaryFile(
  data: Uint8Array<ArrayBufferLike>,
  filename: string,
): Promise<{filepath: string}> {
  try {
    if (
      path.basename(filename) !== filename ||
      filename === '.' ||
      filename === '..'
    ) {
      throw new Error('Temporary file names must not contain path segments.');
    }

    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'chrome-devtools-mcp-'),
    );

    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, data);
    return {filepath};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not save a file: ${message}`, {cause: err});
  }
}
