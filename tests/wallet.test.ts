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
import {authorizeWalletContext} from '../src/walletBridge.js';
import type {Protocol} from '../src/third_party/index.js';

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

  it('authenticates the Chrome execution context, including its ancestors', async () => {
    const checkedUrls: string[] = [];
    const context = {
      id: 1, uniqueId: 'document-1', origin: 'https://allowed.example',
      auxData: {frameId: 'main', isDefault: true},
    } as Protocol.Runtime.ExecutionContextDescription;
    const tree = {frame: {
      id: 'main', url: 'https://allowed.example/app', securityOrigin: 'https://allowed.example',
    }} as Protocol.Page.FrameTree;
    const check = async (url: string) => { checkedUrls.push(url); };
    await authorizeWalletContext(context, tree, check);
    assert.deepStrictEqual(checkedUrls, ['https://allowed.example/app']);
    await assert.rejects(authorizeWalletContext({...context, origin: 'https://blocked.example'}, tree, check), /caller origin/);
    await assert.rejects(authorizeWalletContext({...context, auxData: {frameId: 'missing', isDefault: true}}, tree, check), /no longer exists/);
    await assert.rejects(authorizeWalletContext({...context, auxData: {frameId: 'main', isDefault: false}}, tree, check), /execution context/);
    await assert.rejects(authorizeWalletContext(context, {...tree, frame: {...tree.frame, securityOrigin: 'null'}}, check), /ancestor origin/);
  });
});
