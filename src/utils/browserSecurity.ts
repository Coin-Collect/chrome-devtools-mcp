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

function isOpaqueOrigin(origin: string | undefined): boolean {
  return !origin || origin === 'null' || origin === '://';
}

function getNonOpaqueUrlOrigin(url: string): string | undefined {
  try {
    const origin = new URL(url).origin;
    return isOpaqueOrigin(origin) ? undefined : origin;
  } catch {
    return undefined;
  }
}

export async function assertFrameTreeWhitelisted(
  tree: Protocol.Page.FrameTree,
  check: SecurityCheck = checkNavigationSecurity,
  inheritedOrigin?: string,
): Promise<void> {
  const {url, securityOrigin} = tree.frame;
  const isLocalDocument =
    url === 'about:blank' || url === 'about:srcdoc' || url.startsWith('blob:');
  let effectiveOrigin: string | undefined;

  if (isLocalDocument) {
    const reportedOrigin = isOpaqueOrigin(securityOrigin)
      ? undefined
      : securityOrigin;
    const urlOrigin = url.startsWith('blob:')
      ? getNonOpaqueUrlOrigin(url)
      : undefined;
    effectiveOrigin = reportedOrigin ?? urlOrigin ?? inheritedOrigin;
    if (!effectiveOrigin) {
      throw new SecurityViolationError(
        `Security Violation: opaque frame origin is not allowed (${url}).`,
      );
    }

    for (const origin of new Set(
      [reportedOrigin, urlOrigin, effectiveOrigin].filter(
        (value): value is string => value !== undefined,
      ),
    )) {
      await check(origin);
    }
  } else {
    await check(url);
    if (isOpaqueOrigin(securityOrigin)) {
      effectiveOrigin = getNonOpaqueUrlOrigin(url);
    } else {
      effectiveOrigin = securityOrigin;
      await check(securityOrigin);
    }
    if (!effectiveOrigin) {
      throw new SecurityViolationError(
        `Security Violation: opaque frame origin is not allowed (${url}).`,
      );
    }
  }

  for (const child of tree.childFrames ?? []) {
    await assertFrameTreeWhitelisted(child, check, effectiveOrigin);
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
      // Browser-level filters cannot include both tab and page targets.
      // Pages attach through tabs; recursive attachment also covers OOPIFs.
      const rootFilter = [{type: 'tab'}, {exclude: true}];
      const childFilter = [{type: 'page'}, {type: 'iframe'}, {exclude: true}];
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
              filter: childFilter,
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
        filter: rootFilter,
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
