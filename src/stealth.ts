
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized stealth module for browser evasion features.
 * All patches that modify browser fingerprinting or detection signals
 * should be added here as individual patch functions.
 *
 * Each patch is registered via evaluateOnNewDocument so it persists
 * across navigations within the same page.
 */

interface StealthPage {
    evaluateOnNewDocument(fn: () => void): Promise<{ identifier: string }>;
}

// Collection of stealth patches — add new patches here
const stealthPatches: Array<{ name: string; patch: () => void }> = [
    {
        name: 'navigator.webdriver',
        patch: () => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
                configurable: true,
            });
        },
    },
];

/**
 * Applies all registered stealth patches to a page.
 * Uses evaluateOnNewDocument so patches persist across navigations.
 * Safe to call multiple times — patches are idempotent.
 */
export async function applyStealthPatches(page: StealthPage): Promise<void> {
    for (const { patch } of stealthPatches) {
        await page.evaluateOnNewDocument(patch);
    }
}
