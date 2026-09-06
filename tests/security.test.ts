/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  createWhitelistedImageDownloader,
  assertSecureWindowsWhitelistAcl,
  filterPublicDnsAddresses,
  isPrivateOrReservedAddress,
  loadWhitelistDomains,
  MAX_REMOTE_IMAGE_BYTES,
  normalizeWhitelistDomain,
  validateDownloadedImage,
} from '../src/utils/security.js';

describe('Windows whitelist ACLs', () => {
  it('rejects broad SID write access regardless of locale, ordering or combined rights', () => {
    for (const sid of ['S-1-1-0', 'S-1-5-11', 'S-1-5-32-545']) {
      for (const rights of [2, 6, 0x1f01ff, 0x40000000]) {
        assert.throws(() => assertSecureWindowsWhitelistAcl([{sid, rights, type: 0}]), /Security Violation/);
      }
    }
    assert.doesNotThrow(() => assertSecureWindowsWhitelistAcl([{sid: 'S-1-1-0', rights: 0x120089, type: 0}]));
    assert.doesNotThrow(() => assertSecureWindowsWhitelistAcl([{sid: 'S-1-5-32-544', rights: 0x1f01ff, type: 0}]));
    assert.throws(() => assertSecureWindowsWhitelistAcl({}), /Security Violation/);
    assert.throws(() => assertSecureWindowsWhitelistAcl([{}]), /Security Violation/);
  });
});

describe('remote image security', () => {
  it('rejects private, loopback, and reserved DNS results', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      assert.strictEqual(isPrivateOrReservedAddress(address), true, address);
    }
    assert.strictEqual(isPrivateOrReservedAddress('8.8.8.8'), false);
    assert.strictEqual(
      isPrivateOrReservedAddress('2606:4700:4700::1111'),
      false,
    );
  });

  it('accepts only images whose bytes match the declared MIME type', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    assert.deepStrictEqual(validateDownloadedImage('image/png', png), {
      filename: 'workflow-upload.png',
      mimeType: 'image/png',
    });
    assert.throws(
      () => validateDownloadedImage('image/jpeg', png),
      /does not match/,
    );
    assert.throws(
      () => validateDownloadedImage('image/svg+xml', png),
      /PNG, JPEG, WebP, or GIF/,
    );
  });

  it('rejects images larger than the download limit', () => {
    assert.throws(
      () =>
        validateDownloadedImage(
          'image/png',
          new Uint8Array(MAX_REMOTE_IMAGE_BYTES + 1),
        ),
      /10 MB limit/,
    );
  });

  it('filters private DNS results on every resolution to prevent rebinding', () => {
    const firstResolution = filterPublicDnsAddresses('images.example', [
      {address: '8.8.8.8', family: 4},
    ]);
    assert.deepStrictEqual(firstResolution, [{address: '8.8.8.8', family: 4}]);

    assert.throws(
      () =>
        filterPublicDnsAddresses('images.example', [
          {address: '127.0.0.1', family: 4},
        ]),
      /private or reserved/,
    );
  });

  it('checks every redirect target before requesting it', async () => {
    const checkedUrls: string[] = [];
    let requestCount = 0;
    const download = createWhitelistedImageDownloader({
      checkNavigationSecurity: async url => {
        checkedUrls.push(url);
        if (new URL(url).hostname === 'blocked.example') {
          throw new Error('Security Violation: blocked redirect target');
        }
      },
      requestRemoteImage: async () => {
        requestCount++;
        return {redirect: 'https://blocked.example/image.png'};
      },
    });

    await assert.rejects(
      download('https://allowed.example/image.png'),
      /blocked redirect target/,
    );
    assert.deepStrictEqual(checkedUrls, [
      'https://allowed.example/image.png',
      'https://blocked.example/image.png',
    ]);
    assert.strictEqual(requestCount, 1);
  });
});

describe('whitelist security', () => {
  it('normalizes lowercase ASCII and explicit punycode domains', () => {
    assert.strictEqual(normalizeWhitelistDomain('Example.COM'), 'example.com');
    assert.strictEqual(
      normalizeWhitelistDomain('XN--BCHER-KVA.DE'),
      'xn--bcher-kva.de',
    );
  });

  it('rejects ambiguous and non-registrable whitelist entries', () => {
    for (const domain of [
      '',
      ' example.com',
      '*.example.com',
      'https://example.com',
      'example.com:443',
      'example.com/path',
      'example.com.',
      'com',
      'co.uk',
      'github.io',
      'blogspot.com',
      'localhost',
      '127.0.0.1',
      'bücher.de',
    ]) {
      assert.throws(
        () => normalizeWhitelistDomain(domain),
        /Security Violation/,
      );
    }
  });

  it('loads only valid whitelist files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rockstarx-'));
    const whitelistPath = path.join(directory, 'whitelist.json');
    try {
      await fs.writeFile(
        whitelistPath,
        JSON.stringify(['Example.COM', 'xn--bcher-kva.de', 'example.com']),
      );

      assert.deepStrictEqual(await loadWhitelistDomains(whitelistPath), [
        'example.com',
        'xn--bcher-kva.de',
      ]);
    } finally {
      await fs.rm(directory, {recursive: true, force: true});
    }
  });

  it(
    'rejects symbolic-link whitelist files',
    {skip: process.platform === 'win32'},
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rockstarx-'));
      const targetPath = path.join(directory, 'target.json');
      const whitelistPath = path.join(directory, 'whitelist.json');
      try {
        await fs.writeFile(targetPath, JSON.stringify(['example.com']));
        await fs.symlink(targetPath, whitelistPath);

        await assert.rejects(
          loadWhitelistDomains(whitelistPath),
          /not a symbolic link/,
        );
      } finally {
        await fs.rm(directory, {recursive: true, force: true});
      }
    },
  );

  it(
    'rejects group-writable whitelist files on POSIX',
    {skip: process.platform === 'win32'},
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rockstarx-'));
      const whitelistPath = path.join(directory, 'whitelist.json');
      try {
        await fs.writeFile(whitelistPath, JSON.stringify(['example.com']));
        await fs.chmod(whitelistPath, 0o666);

        await assert.rejects(
          loadWhitelistDomains(whitelistPath),
          /must not be writable by group or other users/,
        );
      } finally {
        await fs.rm(directory, {recursive: true, force: true});
      }
    },
  );
});
