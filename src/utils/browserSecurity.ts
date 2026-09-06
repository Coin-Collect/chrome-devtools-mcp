/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Browser,
  CDPSession,
  Page,
  Protocol,
} from '../third_party/index.js';

import {checkNavigationSecurity, SecurityViolationError} from './security.js';

type SecurityCheck = (url: string) => Promise<void>;

export async function assertFrameTreeWhitelisted(
  tree: Protocol.Page.FrameTree,
  check: SecurityCheck = checkNavigationSecurity,
): Promise<void> {
  const {url, securityOrigin} = tree.frame;
  if (
    url === 'about:blank' ||
    url === 'about:srcdoc' ||
    url.startsWith('blob:')
  ) {
    if (
      !securityOrigin ||
      securityOrigin === 'null' ||
      securityOrigin === '://'
    ) {
      throw new SecurityViolationError(
        'Security Violation: opaque frame origin is not allowed.',
      );
    }
    await check(securityOrigin);
  } else {
    await check(url);
    if (
      !securityOrigin ||
      securityOrigin === 'null' ||
      securityOrigin === '://'
    ) {
      throw new SecurityViolationError(
        'Security Violation: opaque frame origin is not allowed.',
      );
    }
    await check(securityOrigin);
  }
  for (const child of tree.childFrames ?? []) {
    await assertFrameTreeWhitelisted(child, check);
  }
}

export async function assertPageFramesWhitelisted(page: Page): Promise<void> {
  const session = await page.createCDPSession();
  try {
    const {frameTree} = await session.send('Page.getFrameTree');
    await assertFrameTreeWhitelisted(frameTree);
  } finally {
    await session.detach();
  }
}

interface NavigationGuard {
  root: CDPSession;
  violation?: Error;
}
const guards = new WeakMap<Browser, Promise<NavigationGuard>>();

export async function installBrowserNavigationGuard(
  browser: Browser,
  check: SecurityCheck = checkNavigationSecurity,
): Promise<void> {
  let installed = guards.get(browser);
  if (!installed) {
    installed = (async () => {
      const root = await browser.target().createCDPSession();
      const guard: NavigationGuard = {root};
      const pending = new Set<Promise<void>>();
      const filter = [
        {type: 'tab'},
        {type: 'page'},
        {type: 'iframe'},
        {exclude: true},
      ];
      const recordFailure = (error: unknown) => {
        guard.violation ??= new SecurityViolationError(
          `Security Violation: navigation blocked (${error instanceof Error ? error.message : 'verification failed'}).`,
        );
      };
      const attach = (parent: CDPSession) => {
        parent.on('Target.attachedToTarget', event => {
          const configure = async () => {
            const child = parent.connection()?.session(event.sessionId);
            if (!child) {
              throw new Error(
                'Navigation guard could not attach to the new target.',
              );
            }
            attach(child);
            if (event.targetInfo.type !== 'tab') {
              child.on('Fetch.requestPaused', request => {
                void (async () => {
                  try {
                    await check(request.request.url);
                  } catch (error) {
                    recordFailure(error);
                    await child.send('Fetch.failRequest', {
                      requestId: request.requestId,
                      errorReason: 'BlockedByClient',
                    });
                    return;
                  }
                  await child.send('Fetch.continueRequest', {
                    requestId: request.requestId,
                  });
                })().catch(recordFailure);
              });
              await child.send('Fetch.enable', {
                patterns: [{resourceType: 'Document', requestStage: 'Request'}],
              });
            }
            await child.send('Target.setAutoAttach', {
              autoAttach: true,
              waitForDebuggerOnStart: true,
              flatten: true,
              filter,
            });
            if (event.waitingForDebugger) {
              await child.send('Runtime.runIfWaitingForDebugger');
            }
          };
          const task = configure().catch(async error => {
            recordFailure(error);
            // Never resume a newly opened page without its request guard.
            await root
              .send('Target.closeTarget', {targetId: event.targetInfo.targetId})
              .catch(() => {
                // A target that already closed needs no further cleanup.
              });
          });
          pending.add(task);
          void task.finally(() => pending.delete(task));
        });
      };
      attach(root);
      await root.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter,
      });
      while (pending.size) {
        await Promise.all(pending);
      }
      if (guard.violation) {
        await root.detach();
        throw guard.violation;
      }
      return guard;
    })();
    guards.set(browser, installed);
  }
  await installed;
}

export async function throwIfNavigationBlocked(
  browser: Browser,
): Promise<void> {
  const guard = await guards.get(browser);
  if (guard?.violation) {
    const error = guard.violation;
    guard.violation = undefined;
    throw error;
  }
}

export async function withBrowserNavigationSecurity<T>(
  page: Page,
  action: () => Promise<T>,
): Promise<T> {
  await installBrowserNavigationGuard(page.browser());
  await throwIfNavigationBlocked(page.browser());
  try {
    const result = await action();
    await throwIfNavigationBlocked(page.browser());
    return result;
  } catch (error) {
    await throwIfNavigationBlocked(page.browser());
    throw error;
  }
}
