/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {it} from 'node:test';

import puppeteer from 'puppeteer';

import type {Browser, Page, Protocol} from '../src/third_party/index.js';
import {
  assertFrameTreeWhitelisted,
  installBrowserNavigationGuard,
  throwIfNavigationBlocked,
} from '../src/utils/browserSecurity.js';
import {SecurityViolationError} from '../src/utils/security.js';
import {ethereumProviderScript} from '../src/wallet.js';
import {installWalletBridge} from '../src/walletBridge.js';

it('rejects non-whitelisted and opaque child frames before capture or input', async () => {
  const frame = {
    id: 'main',
    url: 'https://allowed.example',
    securityOrigin: 'https://allowed.example',
  };
  const check = async (url: string) => {
    if (!url.startsWith('https://allowed.example')) {
      throw new SecurityViolationError('blocked');
    }
  };
  for (const child of [
    {url: 'https://blocked.example', securityOrigin: 'https://blocked.example'},
    {url: 'about:srcdoc', securityOrigin: 'null'},
  ]) {
    await assert.rejects(
      assertFrameTreeWhitelisted(
        {
          frame,
          childFrames: [{frame: {...frame, ...child}}],
        } as Protocol.Page.FrameTree,
        check,
      ),
    );
  }
  await assertFrameTreeWhitelisted({frame} as Protocol.Page.FrameTree, check);
});

it(
  'blocks the first popup request and every redirect before they reach a server',
  {timeout: 60000},
  async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/redirect') {
        res.writeHead(302, {Location: '/blocked-redirect'});
      } else {
        res.setHeader('Content-Type', 'text/html');
      }
      res.end('<button>open</button>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      });
      await installBrowserNavigationGuard(browser, async url => {
        if (new URL(url).pathname.startsWith('/blocked')) {
          throw new SecurityViolationError('blocked test URL');
        }
      });
      const page = await browser.newPage();
      await page.goto(base);
      const popupEvent = new Promise<Page>(resolve =>
        page.once('popup', popup => {
          if (popup) {
            resolve(popup);
          }
        }),
      );
      await page.evaluate(url => {
        window.open(url);
      }, `${base}/blocked-popup`);
      const popup = await popupEvent;
      await popup.waitForFunction(() => document.readyState === 'complete');
      await assert.rejects(
        throwIfNavigationBlocked(browser),
        /Security Violation/,
      );
      assert(!hits.includes('/blocked-popup'));
      await assert.rejects(page.goto(`${base}/redirect`));
      await assert.rejects(
        throwIfNavigationBlocked(browser),
        /Security Violation/,
      );
      assert(!hits.includes('/blocked-redirect'));
    } finally {
      await browser?.close();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  },
);

it(
  'wallet rejects a cross-origin iframe forging the top origin and signs in the authorized document',
  {timeout: 60000},
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>Wallet test</html>');
    });
    server.listen(0, '0.0.0.0');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      });
      const page = await browser.newPage();
      const session = await page.createCDPSession();
      let signatures = 0;
      const sign = async () => {
        signatures++;
        return 'synthetic-signature';
      };
      await installWalletBridge(
        session,
        {personal: sign, typed: sign},
        async url => {
          if (new URL(url).origin !== base) {
            throw new SecurityViolationError('blocked');
          }
        },
      );
      await page.evaluateOnNewDocument(
        ethereumProviderScript,
        'synthetic-address',
        '0x89',
      );
      await page.goto(base);
      assert.equal(
        await page.evaluate(() => {
          return (
            window as unknown as {
              ethereum: {request(args: object): Promise<unknown>};
            }
          ).ethereum.request({method: 'personal_sign', params: ['0x00']});
        }),
        'synthetic-signature',
      );
      await page.evaluate(
        url => {
          const iframe = document.createElement('iframe');
          iframe.src = url;
          document.body.append(iframe);
        },
        base.replace('127.0.0.1', 'localhost'),
      );
      await page.waitForFrame(frame => frame.url().includes('localhost'));
      const attacker = page
        .frames()
        .find(frame => frame.url().includes('localhost'));
      assert(attacker);
      // Cross-process frames may not have the binding at all, which also denies access.
      const outcome = await attacker.evaluate(async origin => {
        const binding = window.__rockstar_wallet_rpc;
        if (!binding) {
          return 'unavailable';
        }
        return await new Promise<string>(resolve => {
          window.__rockstar_wallet_reply = reply =>
            resolve(reply.error ?? 'signed');
          binding(
            JSON.stringify({
              id: 42,
              method: 'personal_sign',
              value: '0x00',
              frameOrigin: origin,
            }),
          );
        });
      }, base);
      assert.notEqual(outcome, 'signed');
      assert.equal(signatures, 1);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  },
);
