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
        throw new Error(`Güvenlik ihlali: Geçersiz URL adresi (${urlString}).`);
    }

    if (url.protocol !== 'https:') {
        throw new Error(`Güvenlik ihlali: Sadece https protokolüne izin verilmektedir (${url.protocol}).`);
    }

    if (net.isIP(url.hostname)) {
        throw new Error(`Güvenlik ihlali: IP adresi kullanılmasına izin verilmemektedir (${url.hostname}).`);
    }

    if (url.hostname === 'localhost' || url.hostname === '[::1]') {
        throw new Error(`Güvenlik ihlali: Localhost adreslerine gidilmesine izin verilmemektedir (${url.hostname}).`);
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
        throw new Error(`Güvenlik ihlali: Adres whitelist.json dosyasında bulunmuyor (${url.hostname}).`);
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
        throw new Error(`Geçersiz URL formatı: ${urlString}`);
    }

    if (urlString.startsWith('http://')) {
        throw new Error(`Güvenlik ihlali: Whitelist'e eklenen adresler (eğer belirtiliyorsa) https olmalıdır.`);
    }

    if (net.isIP(url.hostname)) {
        throw new Error(`Güvenlik ihlali: IP adresleri whitelist.json dosyasına eklenemez (${url.hostname}).`);
    }

    if (url.hostname === 'localhost' || url.hostname === '[::1]') {
        throw new Error(`Güvenlik ihlali: Localhost whitelist.json dosyasına eklenemez (${url.hostname}).`);
    }
    
    return url.hostname;
}
