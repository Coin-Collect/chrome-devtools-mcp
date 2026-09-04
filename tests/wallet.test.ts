/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  createAuthorizedWalletSigner,
  createWalletWhitelistGuard,
} from '../src/wallet.js';

describe('wallet whitelist guard', () => {
  it('checks the current page URL on every wallet request', async () => {
    let currentUrl = 'https://allowed.example/login';
    const checkedUrls: string[] = [];
    const guard = createWalletWhitelistGuard(
      {url: () => currentUrl},
      async url => {
        checkedUrls.push(url);
      },
    );

    await guard();
    currentUrl = 'https://blocked.example/phishing';
    await guard();

    assert.deepStrictEqual(checkedUrls, [
      'https://allowed.example/login',
      'https://blocked.example/phishing',
    ]);
  });

  it('propagates whitelist violations', async () => {
    const violation = new Error('Security Violation: blocked');
    const guard = createWalletWhitelistGuard(
      {url: () => 'https://blocked.example'},
      async () => {
        throw violation;
      },
    );

    await assert.rejects(guard(), error => error === violation);
  });

  it('does not sign when wallet access is not authorized', async () => {
    const violation = new Error('Security Violation: blocked');
    let signed = false;
    const sign = createAuthorizedWalletSigner(
      async () => {
        throw violation;
      },
      async () => {
        signed = true;
        return 'signature';
      },
    );

    await assert.rejects(sign('message'), error => error === violation);
    assert.strictEqual(signed, false);
  });
});
