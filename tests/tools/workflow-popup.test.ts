/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {it} from 'node:test';
import {setImmediate, setTimeout as delay} from 'node:timers/promises';

import type {Browser, Page, Target} from '../../src/third_party/index.js';
import {
  ensureWhitelistedPage,
  runAndCapturePopup,
} from '../../src/tools/workflowPopup.js';
import {installBrowserNavigationGuard} from '../../src/utils/browserSecurity.js';

function fixture() {
  const browser = new EventEmitter();
  const context = {};
  const opener = {};
  let detached = false;
  const session = Object.assign(new EventEmitter(), {
    send: async () => undefined,
    detach: async () => {
      detached = true;
    },
  });
  const source = Object.assign(new EventEmitter(), {
    browser: () => browser,
    browserContext: () => context,
    target: () => opener,
    createCDPSession: async () => session,
  });
  const page = source as unknown as Page;
  const popup = {isClosed: () => false} as Page;
  const target = (
    options: {
      opener?: unknown;
      context?: unknown;
      url?: string;
      page?: () => Promise<Page | null>;
    } = {},
  ) =>
    ({
      type: () => 'page',
      opener: () => options.opener,
      browserContext: () => options.context ?? context,
      url: () => options.url ?? 'https://example.com/new',
      page: options.page ?? (async () => popup),
    }) as unknown as Target;
  const assertClean = () => {
    assert.equal(source.listenerCount('popup'), 0);
    assert.equal(browser.listenerCount('targetcreated'), 0);
    assert.equal(browser.listenerCount('targetchanged'), 0);
    assert.equal(session.listenerCount('Page.windowOpen'), 0);
    assert.equal(detached, true);
  };
  return {browser, source, page, popup, opener, session, target, assertClean};
}

it('captures a popup emitted during the click and cleans up listeners', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(f.page, async () => {
    f.source.emit('popup', f.popup);
  });
  assert.equal(result, f.popup);
  f.assertClean();
});

it('captures a noopener tab only when its URL was announced by the clicked page', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(f.page, async () => {
    f.session.emit('Page.windowOpen', {url: 'https://example.com/new'});
    f.browser.emit('targetcreated', f.target());
  });
  assert.equal(result, f.popup);
  f.assertClean();
});

it('handles target creation before the window-open event', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(f.page, async () => {
    f.browser.emit('targetcreated', f.target());
    f.session.emit('Page.windowOpen', {url: 'https://example.com/new'});
  });
  assert.equal(result, f.popup);
  f.assertClean();
});

it('waits longer for an announced popup that initializes after the normal timeout', async () => {
  const f = fixture();
  let creation = Promise.resolve();
  const result = await runAndCapturePopup(
    f.page,
    async () => {
      f.session.emit('Page.windowOpen', {url: 'https://example.com/new'});
      creation = delay(40).then(() => {
        f.browser.emit('targetcreated', f.target());
      });
    },
    5,
    200,
  );
  await creation;
  assert.equal(result, f.popup);
  f.assertClean();
});

it('waits for a related target whose Page object initializes slowly', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(
    f.page,
    async () => {
      f.browser.emit(
        'targetcreated',
        f.target({
          opener: f.opener,
          page: async () => {
            await delay(40);
            return f.popup;
          },
        }),
      );
    },
    5,
    200,
  );
  assert.equal(result, f.popup);
  f.assertClean();
});

it('does not capture unrelated tabs or tabs from a different browser context', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(
    f.page,
    async () => {
      f.session.emit('Page.windowOpen', {url: 'https://example.com/new'});
      f.browser.emit('targetcreated', f.target({opener: {}}));
      f.browser.emit('targetcreated', f.target({context: {}}));
      f.browser.emit(
        'targetcreated',
        f.target({url: 'https://other.example/'}),
      );
    },
    5,
    10,
  );
  assert.equal(result, undefined);
  f.assertClean();
});

it('does not capture an unannounced tab without an opener', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(
    f.page,
    async () => {
      f.browser.emit('targetcreated', f.target());
    },
    5,
  );
  assert.equal(result, undefined);
  f.assertClean();
});

it('leaves selection unchanged when no popup opens', async () => {
  const f = fixture();
  assert.equal(
    await runAndCapturePopup(f.page, async () => undefined, 5),
    undefined,
  );
  f.assertClean();
});

it('captures a new noopener target after it navigates away from about:blank', async () => {
  const f = fixture();
  const target = f.target({url: 'about:blank'});
  let url = 'about:blank';
  target.url = () => url;
  const result = await runAndCapturePopup(f.page, async () => {
    f.session.emit('Page.windowOpen', {url: 'https://example.com/new'});
    f.browser.emit('targetcreated', target);
    url = 'https://example.com/new';
    f.browser.emit('targetchanged', target);
  });
  assert.equal(result, f.popup);
  f.assertClean();
});

it('does not capture an existing tab navigating to the announced URL', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(
    f.page,
    async () => {
      f.session.emit('Page.windowOpen', {url: 'https://example.com/new'});
      f.browser.emit('targetchanged', f.target());
    },
    5,
    10,
  );
  assert.equal(result, undefined);
  f.assertClean();
});

it('rejects a popup whose frame tree violates security before selection', async () => {
  let selected = false;
  let detached = false;
  const popup = {
    browser: () => ({}),
    url: () => 'https://example.com/new',
    createCDPSession: async () => ({
      send: async () => ({
        frameTree: {
          frame: {
            url: 'file:///blocked',
            securityOrigin: 'file://',
          },
        },
      }),
      detach: async () => {
        detached = true;
      },
    }),
  } as unknown as Page;
  await assert.rejects(async () => {
    await ensureWhitelistedPage(popup, true);
    selected = true;
  }, /Security Violation/);
  assert.equal(selected, false);
  assert.equal(detached, true);
});

it('rechecks navigation guard failures after waiting on a blank popup', async () => {
  const root = Object.assign(new EventEmitter(), {
    send: async () => undefined,
    connection: () => ({session: () => undefined}),
  });
  const browser = {
    target: () => ({createCDPSession: async () => root}),
  } as unknown as Browser;
  await installBrowserNavigationGuard(browser);
  let selected = false;
  const popup = {
    browser: () => browser,
    url: () => 'about:blank',
    waitForNavigation: async () => {
      root.emit('Target.attachedToTarget', {
        sessionId: 'missing',
        targetInfo: {type: 'page', targetId: 'unprotected-popup'},
      });
      await setImmediate();
      throw new Error('Navigation timed out');
    },
  } as unknown as Page;
  await assert.rejects(async () => {
    await ensureWhitelistedPage(popup, true);
    selected = true;
  }, /Security Violation/);
  assert.equal(selected, false);
});

it('cleans up after a failed click without swallowing the error', async () => {
  const f = fixture();
  const error = new Error('click failed');
  await assert.rejects(
    runAndCapturePopup(f.page, async () => {
      throw error;
    }),
    error,
  );
  f.assertClean();
});

it('ignores a popup that closes before initialization', async () => {
  const f = fixture();
  const result = await runAndCapturePopup(
    f.page,
    async () => {
      f.source.emit('popup', {isClosed: () => true});
      f.browser.emit(
        'targetcreated',
        f.target({
          opener: f.opener,
          page: async () => {
            throw new Error('Target closed');
          },
        }),
      );
    },
    5,
    10,
  );
  assert.equal(result, undefined);
  f.assertClean();
});
