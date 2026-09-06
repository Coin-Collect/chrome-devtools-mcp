/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Protocol} from './third_party/index.js';
import {
  checkNavigationSecurity,
  SecurityViolationError,
} from './utils/security.js';

export const WALLET_BINDING = '__rockstar_wallet_rpc';

export async function authorizeWalletContext(
  context: Protocol.Runtime.ExecutionContextDescription,
  tree: Protocol.Page.FrameTree,
  check: (url: string) => Promise<void> = checkNavigationSecurity,
): Promise<void> {
  const aux = context.auxData as
    | {isDefault?: boolean; frameId?: string}
    | undefined;
  if (!aux?.isDefault || !aux.frameId || !context.uniqueId) {
    throw new SecurityViolationError(
      'Security Violation: wallet execution context is invalid.',
    );
  }
  const origin = new URL(tree.frame.url).origin;
  if (context.origin !== origin) {
    throw new SecurityViolationError(
      'Security Violation: wallet caller origin is not the top-level origin.',
    );
  }
  const findPath = (
    node: Protocol.Page.FrameTree,
  ): Protocol.Page.Frame[] | undefined => {
    if (node.frame.id === aux.frameId) {
      return [node.frame];
    }
    for (const child of node.childFrames ?? []) {
      const result = findPath(child);
      if (result) {
        return [node.frame, ...result];
      }
    }
    return undefined;
  };
  const frames = findPath(tree);
  if (!frames) {
    throw new SecurityViolationError(
      'Security Violation: wallet caller frame no longer exists.',
    );
  }
  for (const frame of frames) {
    if (frame.securityOrigin !== origin) {
      throw new SecurityViolationError(
        'Security Violation: wallet ancestor origin is not allowed.',
      );
    }
    await check(
      frame.url === 'about:blank' || frame.url === 'about:srcdoc'
        ? frame.securityOrigin
        : frame.url,
    );
  }
}

export async function installWalletBridge(
  session: CDPSession,
  signers: {
    personal(message: string): Promise<string>;
    typed(message: string): Promise<string>;
  },
  check: (url: string) => Promise<void> = checkNavigationSecurity,
): Promise<void> {
  const contexts = new Map<
    number,
    Protocol.Runtime.ExecutionContextDescription
  >();
  let activeRequests = 0;
  session.on('Runtime.executionContextCreated', ({context}) =>
    contexts.set(context.id, context),
  );
  session.on('Runtime.executionContextDestroyed', event =>
    contexts.delete(event.executionContextId),
  );
  session.on('Runtime.executionContextsCleared', () => contexts.clear());
  session.on('Runtime.bindingCalled', event => {
    if (event.name !== WALLET_BINDING || event.payload.length > 65536) {
      return;
    }
    const context = contexts.get(event.executionContextId);
    if (!context) {
      return;
    }
    void (async () => {
      const request: unknown = JSON.parse(event.payload);
      if (
        !request ||
        typeof request !== 'object' ||
        !('id' in request) ||
        typeof request.id !== 'number' ||
        !Number.isSafeInteger(request.id)
      ) {
        return;
      }
      const reply: {id: number; result?: unknown; error?: string} = {
        id: request.id,
      };
      const admitted = activeRequests < 16;
      if (admitted) {
        activeRequests++;
      }
      try {
        if (!admitted) {
          throw new Error('Too many pending wallet requests.');
        }
        const {frameTree} = await session.send('Page.getFrameTree');
        await authorizeWalletContext(context, frameTree, check);
        if (contexts.get(context.id) !== context) {
          throw new Error('Wallet document changed during authorization.');
        }
        if (!('method' in request)) {
          throw new Error('Wallet method is required.');
        }
        if (request.method === 'access') {
          reply.result = null;
        } else {
          if (!('value' in request) || typeof request.value !== 'string') {
            throw new Error('Wallet signing payload must be a string.');
          }
          if (request.method === 'personal_sign') {
            reply.result = await signers.personal(request.value);
          } else if (request.method === 'typed_sign') {
            reply.result = await signers.typed(request.value);
          } else {
            throw new Error('Unsupported wallet method.');
          }
        }
      } catch (error) {
        reply.error =
          error instanceof Error ? error.message : 'Wallet request failed.';
      } finally {
        if (admitted) {
          activeRequests--;
        }
      }
      // uniqueContextId prevents delivery into a replacement document after navigation.
      if (contexts.get(context.id) === context) {
        await session.send('Runtime.evaluate', {
          expression: `window.__rockstar_wallet_reply(${JSON.stringify(reply)})`,
          uniqueContextId: context.uniqueId,
        });
      }
    })().catch(() => {
      // Malformed messages and destroyed documents cannot receive a reply.
    });
  });
  await session.send('Runtime.enable');
  await session.send('Runtime.addBinding', {name: WALLET_BINDING});
}
