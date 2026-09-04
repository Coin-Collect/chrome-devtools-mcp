/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  getOutputDirectory,
  saveOutputFile,
  saveTemporaryFile,
} from '../../src/utils/files.js';

describe('files', () => {
  it('saves files only within the controlled output directory', async () => {
    const filename = path.join(
      'files-test',
      `output-${process.pid}-${Date.now()}.txt`,
    );
    const expectedPath = path.join(getOutputDirectory(), filename);

    try {
      const file = await saveOutputFile(
        new TextEncoder().encode('first version'),
        filename,
      );
      assert.equal(file.filename, expectedPath);
      assert.equal(await readFile(file.filename, 'utf8'), 'first version');

      await assert.rejects(
        saveOutputFile(new TextEncoder().encode('second version'), filename),
        /Refusing to overwrite existing file/,
      );

      await saveOutputFile(
        new TextEncoder().encode('second version'),
        filename,
        {
          overwrite: true,
        },
      );
      assert.equal(await readFile(expectedPath, 'utf8'), 'second version');

      await assert.rejects(
        saveOutputFile(new Uint8Array(), path.join('..', 'outside.txt')),
        /controlled output directory/,
      );
    } finally {
      await rm(path.dirname(expectedPath), {recursive: true, force: true});
    }
  });

  it('rejects path segments in temporary file names', async () => {
    await assert.rejects(
      saveTemporaryFile(new Uint8Array(), path.join('nested', 'file.txt')),
      /Temporary file names must not contain path segments/,
    );
  });

  it('rejects symbolic links within the output directory', async t => {
    const linkDirectory = path.join(
      getOutputDirectory(),
      `files-test-link-${process.pid}-${Date.now()}`,
    );
    const targetDirectory = path.join(
      getOutputDirectory(),
      `files-test-target-${process.pid}-${Date.now()}`,
    );

    try {
      await mkdir(targetDirectory, {recursive: true});
      try {
        await symlink(
          targetDirectory,
          linkDirectory,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          t.skip('Creating symbolic links is not permitted on this host.');
          return;
        }
        throw error;
      }

      await assert.rejects(
        saveOutputFile(
          new Uint8Array(),
          path.join(path.basename(linkDirectory), 'file.txt'),
        ),
        /symbolic link/,
      );
    } finally {
      await rm(linkDirectory, {recursive: true, force: true});
      await rm(targetDirectory, {recursive: true, force: true});
    }
  });

  it('rejects a symbolic-link output file', async t => {
    const directory = path.join(
      getOutputDirectory(),
      `files-test-file-link-${process.pid}-${Date.now()}`,
    );
    const targetPath = path.join(directory, 'target.txt');
    const linkPath = path.join(directory, 'link.txt');

    try {
      await mkdir(directory, {recursive: true});
      await writeFile(targetPath, 'original');
      try {
        await symlink(targetPath, linkPath, 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          t.skip('Creating symbolic links is not permitted on this host.');
          return;
        }
        throw error;
      }

      await assert.rejects(
        saveOutputFile(
          new TextEncoder().encode('replacement'),
          path.relative(getOutputDirectory(), linkPath),
        ),
        /symbolic link/,
      );
      assert.equal(await readFile(targetPath, 'utf8'), 'original');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
