/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page, Protocol, Target} from '../third_party/index.js';
import {
  assertPageFramesWhitelisted,
  throwIfNavigationBlocked,
} from '../utils/browserSecurity.js';
import {checkNavigationSecurity} from '../utils/security.js';

export async function ensureWhitelistedPage(
  page: Page,
  waitForInitialNavigation = false,
): Promise<void> {
  await throwIfNavigationBlocked(page.browser());
  if (waitForInitialNavigation && page.url() === 'about:blank') {
    try {
      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 5_000,
      });
    } catch {
      // A popup can intentionally remain blank until a later action.
    }
  }

  // A blocked initial request can leave the popup at about:blank.
  await throwIfNavigationBlocked(page.browser());
  if (waitForInitialNavigation) {
    await assertPageFramesWhitelisted(page);
    await throwIfNavigationBlocked(page.browser());
  }
  if (page.url() !== 'about:blank') {
    await checkNavigationSecurity(page.url());
  }
}

/** Capture only tabs attributable to this page, including noopener links. */
export async function runAndCapturePopup(
  page: Page,
  action: () => Promise<void>,
  timeout = 1_000,
  openingTimeout = 5_000,
): Promise<Page | undefined> {
  const browser = page.browser();
  const opener = page.target();
  const session = await page.createCDPSession();
  const announcedUrls = new Set<string>();
  const candidates = new Set<Target>();
  const pending = new Set<Target>();
  let active = true;
  let popup: Page | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (page: Page | undefined) => void;
  const captured = new Promise<Page | undefined>(res => {
    resolve = res;
  });
  const onPopup = (candidate: Page | null) => {
    if (active && candidate && !candidate.isClosed()) {
      popup ??= candidate;
      resolve(popup);
    }
  };
  const inspect = (target: Target) => {
    if (
      pending.has(target) ||
      target.type() !== 'page' ||
      target.browserContext() !== page.browserContext()
    ) {
      return;
    }
    const source = target.opener();
    // A missing opener alone is not evidence that our click opened this tab.
    if (source !== opener && (source || !announcedUrls.has(target.url()))) {
      return;
    }
    pending.add(target);
    void target
      .page()
      .then(onPopup)
      .catch(() => {
        // A tab can close before Puppeteer finishes initializing it.
      });
  };
  const onTarget = (target: Target) => {
    candidates.add(target);
    inspect(target);
  };
  const onTargetChanged = (target: Target) => {
    if (candidates.has(target)) {
      inspect(target);
    }
  };
  const onWindowOpen = (event: Protocol.Page.WindowOpenEvent) => {
    const firstAnnouncement = announcedUrls.size === 0;
    announcedUrls.add(event.url);
    for (const target of candidates) {
      inspect(target);
    }
    if (timer && firstAnnouncement) {
      clearTimeout(timer);
      timer = setTimeout(() => resolve(undefined), openingTimeout);
    }
  };

  page.on('popup', onPopup);
  browser.on('targetcreated', onTarget);
  browser.on('targetchanged', onTargetChanged);
  session.on('Page.windowOpen', onWindowOpen);
  try {
    await session.send('Page.enable');
    await action();
    if (popup) {
      return popup;
    }
    timer = setTimeout(
      () => resolve(undefined),
      announcedUrls.size || pending.size ? openingTimeout : timeout,
    );
    return await captured;
  } finally {
    active = false;
    clearTimeout(timer);
    page.off('popup', onPopup);
    browser.off('targetcreated', onTarget);
    browser.off('targetchanged', onTargetChanged);
    session.off('Page.windowOpen', onWindowOpen);
    await session.detach().catch(() => {
      // The opener may have closed as part of the click.
    });
  }
}
