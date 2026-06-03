/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame, Page} from '../third_party/index.js';

export interface SelectorStrategy {
    type: string;
    value: string;
    priority: number;
}

export function isCssCompatibleSelector(strategy: SelectorStrategy): boolean {
    return strategy.type !== 'xpath' && strategy.type !== 'text';
}

export function pickBestFrameSelector(strategies: SelectorStrategy[]): string {
    const cssCompatible = strategies.filter(isCssCompatibleSelector);
    if (cssCompatible.length > 0) {
        return cssCompatible[0].value;
    }

    return strategies[0]?.value ?? '';
}

export async function resolveFrame(
    page: Page,
    frameSelectors: string[] | undefined,
): Promise<Frame> {
    let currentFrame = page.mainFrame();
    if (!frameSelectors || frameSelectors.length === 0) {
        return currentFrame;
    }

    for (const selector of frameSelectors) {
        let iframeHandle = await currentFrame.$(selector);
        if (!iframeHandle && (selector.startsWith('/') || selector.startsWith('('))) {
            const iframeHandles = await currentFrame.$$('xpath/' + selector);
            iframeHandle = iframeHandles.length > 0 ? iframeHandles[0] : null;
        }
        if (!iframeHandle) {
            throw new Error(`Iframe element not found using selector: ${selector}`);
        }
        const contentFrame = await iframeHandle.contentFrame();
        if (!contentFrame) {
            throw new Error(`Could not access contentFrame of iframe: ${selector}`);
        }
        currentFrame = contentFrame;
    }

    return currentFrame;
}
