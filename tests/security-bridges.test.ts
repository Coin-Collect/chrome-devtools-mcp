/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {it} from 'node:test';
import {setImmediate} from 'node:timers/promises';

import type {Browser, CDPSession} from '../src/third_party/index.js';
import {
  installBrowserNavigationGuard,
  throwIfNavigationBlocked,
} from '../src/utils/browserSecurity.js';
import {SecurityViolationError} from '../src/utils/security.js';
import {installWalletBridge, WALLET_BINDING} from '../src/walletBridge.js';

class TestSession extends EventEmitter {
  commands: Array<{method: string; params?: Record<string, unknown>}> = [];
  children = new Map<string, TestSession>();
  frameTree = {
    frame: {
      id: 'top',
      url: 'https://allowed.example/',
      securityOrigin: 'https://allowed.example',
    },
    childFrames: [
      {
        frame: {
          id: 'attacker',
          url: 'https://blocked.example/',
          securityOrigin: 'https://blocked.example',
        },
      },
    ],
  };
  failEnable = false;
  async send(method: string, params?: Record<string, unknown>) {
    this.commands.push({method, params});
    if (this.failEnable && method === 'Fetch.enable') {
      throw new Error('Could not enable interception');
    }
    return method === 'Page.getFrameTree' ? {frameTree: this.frameTree} : {};
  }
  connection() {
    return {session: (id: string) => this.children.get(id)};
  }
  async detach() {
    return;
  }
  asCdp() {
    return this as unknown as CDPSession;
  }
}

it('holds popup requests until checked, blocks denied URLs, and closes unprotected targets', async () => {
  const root = new TestSession();
  const browser = {
    target: () => ({createCDPSession: async () => root.asCdp()}),
  } as unknown as Browser;
  let releaseCheck!: () => void;
  const checking = new Promise<void>(resolve => {
    releaseCheck = resolve;
  });
  await installBrowserNavigationGuard(browser, async url => {
    await checking;
    if (url.includes('blocked')) {
      throw new SecurityViolationError('blocked URL');
    }
  });
  const popup = new TestSession();
  root.children.set('popup-session', popup);
  root.emit('Target.attachedToTarget', {
    sessionId: 'popup-session',
    waitingForDebugger: true,
    targetInfo: {type: 'page', targetId: 'popup-target'},
  });
  await setImmediate();
  assert(
    popup.commands.findIndex(c => c.method === 'Fetch.enable') <
      popup.commands.findIndex(
        c => c.method === 'Runtime.runIfWaitingForDebugger',
      ),
  );
  popup.emit('Fetch.requestPaused', {
    requestId: 'first',
    request: {url: 'https://blocked.example'},
  });
  await setImmediate();
  assert(!popup.commands.some(c => c.method === 'Fetch.continueRequest'));
  releaseCheck();
  await setImmediate();
  assert(popup.commands.some(c => c.method === 'Fetch.failRequest'));
  await assert.rejects(throwIfNavigationBlocked(browser), /Security Violation/);
  popup.emit('Fetch.requestPaused', {
    requestId: 'allowed',
    request: {url: 'https://allowed.example'},
  });
  await setImmediate();
  assert(
    popup.commands.some(
      c =>
        c.method === 'Fetch.continueRequest' &&
        c.params?.requestId === 'allowed',
    ),
  );

  const broken = new TestSession();
  broken.failEnable = true;
  root.children.set('broken-session', broken);
  root.emit('Target.attachedToTarget', {
    sessionId: 'broken-session',
    waitingForDebugger: true,
    targetInfo: {type: 'page', targetId: 'broken-target'},
  });
  await setImmediate();
  assert(
    !broken.commands.some(c => c.method === 'Runtime.runIfWaitingForDebugger'),
  );
  assert(
    root.commands.some(
      c =>
        c.method === 'Target.closeTarget' &&
        c.params?.targetId === 'broken-target',
    ),
  );
  await assert.rejects(throwIfNavigationBlocked(browser), /Security Violation/);
});

it('wallet ignores forged origin fields and refuses stale documents without invoking signers', async () => {
  const session = new TestSession();
  let signatures = 0;
  const sign = async () => {
    signatures++;
    return 'test-signature';
  };
  let duringCheck: () => void = () => undefined;
  await installWalletBridge(
    session.asCdp(),
    {personal: sign, typed: sign},
    async () => {
      duringCheck();
    },
  );
  const context = (id: number, origin: string, frameId: string) => ({
    id,
    uniqueId: `document-${id}`,
    origin,
    auxData: {frameId, isDefault: true},
  });
  session.emit('Runtime.executionContextCreated', {
    context: context(1, 'https://allowed.example', 'top'),
  });
  session.emit('Runtime.executionContextCreated', {
    context: context(2, 'https://blocked.example', 'attacker'),
  });
  const request = (executionContextId: number) =>
    session.emit('Runtime.bindingCalled', {
      name: WALLET_BINDING,
      executionContextId,
      payload: JSON.stringify({
        id: 1,
        method: 'personal_sign',
        value: '0x00',
        frameOrigin: 'https://allowed.example',
      }),
    });
  request(2);
  await setImmediate();
  assert.equal(signatures, 0);
  request(1);
  await setImmediate();
  assert.equal(signatures, 1);
  assert(
    session.commands.some(
      c =>
        c.method === 'Runtime.evaluate' &&
        c.params?.uniqueContextId === 'document-1',
    ),
  );
  duringCheck = () => session.emit('Runtime.executionContextsCleared');
  request(1);
  await setImmediate();
  assert.equal(signatures, 1);
});
