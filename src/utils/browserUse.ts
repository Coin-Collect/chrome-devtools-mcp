/**
 * Browser-Use cloud browser integration.
 * Manages WSS connection to browser-use.com remote browsers.
 */

import {logger} from '../logger.js';
import {puppeteer} from '../third_party/index.js';
import type {Browser, Target} from '../third_party/index.js';

const BROWSER_USE_WSS_BASE = 'wss://connect.browser-use.com';

function makeTargetFilter() {
    const ignoredPrefixes = new Set([
        'chrome://',
        'chrome-extension://',
        'chrome-untrusted://',
    ]);

    return function targetFilter(target: Target): boolean {
        if (target.url() === 'chrome://newtab/') {
            return true;
        }
        if (target.url().startsWith('chrome://inspect')) {
            return true;
        }
        for (const prefix of ignoredPrefixes) {
            if (target.url().startsWith(prefix)) {
                return false;
            }
        }
        return true;
    };
}

export function getBrowserUseApiKey(): string | undefined {
    return process.env['BROWSER_USE_API_KEY'];
}

export function buildBrowserUseWssUrl(apiKey: string): string {
    const url = new URL(BROWSER_USE_WSS_BASE);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('proxyCountryCode', 'us');
    return url.toString();
}

let cachedBrowser: Browser | undefined;

export async function connectBrowserUse(apiKey: string): Promise<Browser> {
    if (cachedBrowser?.connected) {
        return cachedBrowser;
    }

    const wssUrl = buildBrowserUseWssUrl(apiKey);
    logger(`Connecting to Browser-Use cloud browser...`);

    try {
        cachedBrowser = await puppeteer.connect({
            browserWSEndpoint: wssUrl,
            targetFilter: makeTargetFilter(),
            defaultViewport: null,
            handleDevToolsAsPage: true,
        });
    } catch (err) {
        throw new Error(
            'Could not connect to Browser-Use cloud browser. Check your BROWSER_USE_API_KEY.',
            { cause: err },
        );
    }

    logger('Connected to Browser-Use cloud browser');
    return cachedBrowser;
}
