/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

export async function checkNavigationSecurity(urlString: string): Promise<void> {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch (e) {
        throw new Error(`Security Violation: Invalid URL format (${urlString}).`);
    }

    const forbiddenProtocols = ['file:', 'javascript:', 'data:', 'chrome:'];
    if (forbiddenProtocols.includes(url.protocol)) {
        throw new Error(`Security Violation: Navigation to '${url.protocol}' protocols is strictly forbidden.`);
    }

    if (url.protocol !== 'https:') {
        throw new Error(`Security Violation: Only 'https:' protocol is allowed (${url.protocol}).`);
    }

    if (net.isIP(url.hostname)) {
        throw new Error(`Security Violation: IP addresses are not allowed (${url.hostname}).`);
    }

    if (url.hostname === 'localhost' || url.hostname === '[::1]') {
        throw new Error(`Security Violation: Navigating to localhost is not allowed (${url.hostname}).`);
    }

    const whitelistPath = path.resolve(process.cwd(), 'whitelist.json');
    let whitelist: string[] = [];
    try {
        const data = await fs.readFile(whitelistPath, 'utf8');
        whitelist = JSON.parse(data);
        if (!Array.isArray(whitelist)) whitelist = [];
    } catch (e) {
        whitelist = [];
    }

    const isAllowed = whitelist.some(domain => 
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
        throw new Error(`Security Violation: The address was not found in whitelist.json (${url.hostname}).`);
    }
}

export function validateWhitelistAddition(urlString: string): string {
    let url: URL;
    let urlToParse = urlString;
    try {
        if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
            urlToParse = `https://${urlToParse}`;
        }
        url = new URL(urlToParse);
    } catch {
        throw new Error(`Invalid URL format: ${urlString}`);
    }

    if (urlString.startsWith('http://')) {
        throw new Error(`Security Violation: URLs added to the whitelist (if specified) must use https.`);
    }

    if (net.isIP(url.hostname)) {
        throw new Error(`Security Violation: IP addresses cannot be added to whitelist.json (${url.hostname}).`);
    }

    if (url.hostname === 'localhost' || url.hostname === '[::1]') {
        throw new Error(`Security Violation: Localhost cannot be added to whitelist.json (${url.hostname}).`);
    }
    
    return url.hostname;
}
