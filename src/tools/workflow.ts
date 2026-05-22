
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { supabase } from '../supabase.js';
import { zod } from '../third_party/index.js';
import type { ElementHandle, KeyInput, Page, Frame } from '../third_party/index.js';
import { checkNavigationSecurity, validateWhitelistAddition } from '../utils/security.js';

import { ToolCategory } from './categories.js';
import { definePageTool, defineTool } from './ToolDefinition.js';
import type { ContextPage } from './ToolDefinition.js';


export const createWorkflow = defineTool({
    name: 'create_workflow',
    description: 'Creates a new workflow in the database',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        title: zod.string().describe('The title of the workflow'),
        website_url: zod
            .string()
            .optional()
            .describe('The target website URL for the workflow'),
        description: zod
            .string()
            .optional()
            .describe('A description of what the workflow does'),
        success_criteria: zod
            .string()
            .optional()
            .describe('Criteria to determine if the workflow succeeded'),
    },
    handler: async (request, response) => {
        const { title, website_url, description, success_criteria } = request.params;

        const { data, error } = await supabase
            .from('workflows')
            .insert([
                {
                    title,
                    website_url,
                    description,
                    success_criteria,
                    status: 'draft',
                },
            ])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create workflow: ${error.message}`);
        }

        response.appendResponseLine(
            `Successfully created workflow "${data.title}" (ID: ${data.id})`,
        );
    },
});

export const listWorkflows = defineTool({
    name: 'list_workflows',
    description: 'Lists all workflows and their steps from the database',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: true,
    },
    schema: {},
    handler: async (_request, response) => {
        const { data, error } = await supabase
            .from('workflows')
            .select(`
                *,
                workflow_steps (*)
            `)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Failed to list workflows: ${error.message}`);
        }

        if (!data || data.length === 0) {
            response.appendResponseLine('No workflows found in the database.');
            return;
        }

        for (const workflow of data) {
            response.appendResponseLine(`Workflow: ${workflow.title} (ID: ${workflow.id})`);
            response.appendResponseLine(`  Status: ${workflow.status}`);
            if (workflow.website_url) response.appendResponseLine(`  URL: ${workflow.website_url}`);
            if (workflow.description) response.appendResponseLine(`  Description: ${workflow.description}`);
            if (workflow.success_criteria) response.appendResponseLine(`  Success Criteria: ${workflow.success_criteria}`);

            if (workflow.workflow_steps && workflow.workflow_steps.length > 0) {
                response.appendResponseLine('  Steps:');
                const sortedSteps = workflow.workflow_steps.sort((a: any, b: any) => a.step_order - b.step_order);
                for (const step of sortedSteps) {
                    response.appendResponseLine(`    ${step.step_order}. ${step.action}: ${step.description || ''} (${step.action_value || ''})`);
                }
            } else {
                response.appendResponseLine('  No steps defined for this workflow.');
            }
            response.appendResponseLine('---');
        }
    },
});

interface SelectorStrategy {
    type: string;
    value: string;
    priority: number;
}

interface SelectorsData {
    best_selector: string;
    strategies: SelectorStrategy[];
    ax_node_meta: {
        role: string;
        name: string;
        description: string;
    };
    frame_selectors?: string[];
}

async function generateSelectorsForElement(
    handle: ElementHandle<Element>,
    frame: Frame,
): Promise<SelectorStrategy[]> {
    const strategies: SelectorStrategy[] = await handle.evaluate((el: Element) => {
        const results: SelectorStrategy[] = [];

        // 1. ID selector (highest priority)
        if (el.id) {
            results.push({
                type: 'id',
                value: `#${el.id}`,
                priority: 1,
            });
        }

        // 2. data-testid / data-test / data-cy attributes
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
        if (testId) {
            const attrName = el.hasAttribute('data-testid') ? 'data-testid' : el.hasAttribute('data-test') ? 'data-test' : 'data-cy';
            results.push({
                type: 'testid',
                value: `[${attrName}="${testId}"]`,
                priority: 2,
            });
        }

        // 3. ARIA label selector
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
            results.push({
                type: 'aria-label',
                value: `[aria-label="${ariaLabel}"]`,
                priority: 3,
            });
        }

        // 4. Name attribute (for form elements)
        const name = el.getAttribute('name');
        if (name) {
            results.push({
                type: 'name',
                value: `[name="${name}"]`,
                priority: 4,
            });
        }

        // 5. Role + accessible name combination
        const role = el.getAttribute('role');
        if (role && ariaLabel) {
            results.push({
                type: 'role-name',
                value: `[role="${role}"][aria-label="${ariaLabel}"]`,
                priority: 5,
            });
        }

        // 6. Class-based selector (with tag)
        if (el.className && typeof el.className === 'string' && el.className.trim()) {
            const classes = el.className.trim().split(/\s+/).slice(0, 3).join('.');
            results.push({
                type: 'class',
                value: `${el.tagName.toLowerCase()}.${classes}`,
                priority: 6,
            });
        }

        // 7. Tag + type combination (for inputs)
        const inputType = el.getAttribute('type');
        if (el.tagName === 'INPUT' && inputType) {
            results.push({
                type: 'input-type',
                value: `input[type="${inputType}"]`,
                priority: 7,
            });
        }

        // 8. Placeholder selector (for inputs/textareas)
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) {
            results.push({
                type: 'placeholder',
                value: `[placeholder="${placeholder}"]`,
                priority: 8,
            });
        }

        // 9. Text content selector (for buttons/links)
        const textContent = el.textContent?.trim();
        if (textContent && textContent.length < 50 && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
            results.push({
                type: 'text',
                value: `//${el.tagName.toLowerCase()}[normalize-space()="${textContent}"]`,
                priority: 9,
            });
        }

        // 10. XPath with index (fallback)
        const getXPath = (element: Element): string => {
            if (element.id) return `//*[@id="${element.id}"]`;
            const parts: string[] = [];
            let current: Element | null = element;
            while (current && current.nodeType === Node.ELEMENT_NODE) {
                let index = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName) index++;
                    sibling = sibling.previousElementSibling;
                }
                parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
                current = current.parentElement;
            }
            return '/' + parts.join('/');
        };
        results.push({
            type: 'xpath',
            value: getXPath(el),
            priority: 10,
        });

        // 11. CSS path (unique path from root)
        const getCssPath = (element: Element): string => {
            const path: string[] = [];
            let current: Element | null = element;
            while (current && current.nodeType === Node.ELEMENT_NODE) {
                let selector = current.tagName.toLowerCase();
                if (current.id) {
                    selector = `#${current.id}`;
                    path.unshift(selector);
                    break;
                }
                let nth = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName) nth++;
                    sibling = sibling.previousElementSibling;
                }
                if (nth > 1) selector += `:nth-of-type(${nth})`;
                path.unshift(selector);
                current = current.parentElement;
            }
            return path.join(' > ');
        };
        results.push({
            type: 'css-path',
            value: getCssPath(el),
            priority: 11,
        });

        return results;
    });

    // Sort by priority
    strategies.sort((a, b) => a.priority - b.priority);

    // Filter out selectors that match more than one element in this frame
    const uniqueStrategies: SelectorStrategy[] = [];
    for (const strategy of strategies) {
        const matchCount = await frame.evaluate((selectorValue: string, selectorType: string) => {
            if (selectorType === 'xpath' || selectorType === 'text') {
                const result = document.evaluate(
                    selectorValue,
                    document,
                    null,
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null,
                );
                return result.snapshotLength;
            }
            return document.querySelectorAll(selectorValue).length;
        }, strategy.value, strategy.type);

        if (matchCount === 1) {
            uniqueStrategies.push(strategy);
        }
    }

    return uniqueStrategies;
}

async function resolveFrame(
    page: Page,
    frameSelectors: string[] | undefined,
): Promise<Frame> {
    let currentFrame = page.mainFrame();
    if (!frameSelectors || frameSelectors.length === 0) {
        return currentFrame;
    }

    for (const selector of frameSelectors) {
        const iframeHandle = await currentFrame.$(selector);
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

async function injectSimulationStyles(frame: Page | Frame): Promise<void> {
    await frame.evaluate(() => {
        const existingStyle = document.getElementById('__wf_sim_style');
        if (existingStyle) return;

        const style = document.createElement('style');
        style.id = '__wf_sim_style';
        style.textContent = `
            @keyframes __wf_sim_pulse {
                0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6); }
                50% { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0); }
                100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
            }
            .__wf_sim_highlight {
                outline: 3px solid #6366f1 !important;
                outline-offset: 2px !important;
                animation: __wf_sim_pulse 1s ease-in-out infinite !important;
                position: relative !important;
                z-index: 999998 !important;
            }
        `;
        document.head.appendChild(style);
    });
}

export const addWorkflowStep = definePageTool({
    name: 'add_workflow_step',
    description: 'Adds or updates a step in a workflow. If step_order exists, updates it. If not provided, appends as next step.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        workflow_id: zod.number().describe('The ID of the workflow to add the step to'),
        action: zod.enum(['click', 'type', 'wait', 'scroll', 'nav', 'hover', 'extract', 'screenshot', 'upload_image']).describe('The action type for this step'),
        uid: zod.string().optional().describe('The uid of an element on the page from the page content snapshot. Required for click, type, hover, extract, scroll actions.'),
        action_value: zod.string().optional().describe('Value for the action (e.g., text to type, wait duration, URL for nav, URL for upload image)'),
        step_description: zod.string().optional().describe('A description of what this step does'),
        step_order: zod.number().optional().describe('The order of this step. If not provided, will be set to last + 1. If exists, will update.'),
    },
    handler: async (request, response) => {
        const { workflow_id, action, uid, action_value, step_description, step_order } = request.params;

        // Actions that require an element
        const elementRequiredActions = ['click', 'type', 'hover', 'extract', 'scroll', 'upload_image'];
        const requiresElement = elementRequiredActions.includes(action);

        let selectorsData: SelectorsData | null = null;

        if (uid) {
            // Get element handle and AX node from snapshot
            const handle = await request.page.getElementByUid(uid);
            const node = request.page.getAXNodeByUid(uid);

            if (!node) {
                throw new Error(`No accessibility node found for uid ${uid}`);
            }

            // Extract AX node metadata from SerializedAXNode properties
            const nodeAsRecord = node as unknown as Record<string, unknown>;
            const ax_node_meta = {
                role: String(nodeAsRecord['role'] || ''),
                name: String(nodeAsRecord['name'] || ''),
                description: String(nodeAsRecord['description'] || ''),
            };

            // Detect if the element is inside shadow DOM (e.g. spinbutton inside <input type="date">)
            // If so, promote to the shadow host element since shadow DOM internals are unreachable by CSS/XPath
            const isInShadowDOM = await handle.evaluate((el: Element) => {
                const root = el.getRootNode();
                return root instanceof ShadowRoot;
            });

            let selectorHandle = handle;
            if (isInShadowDOM) {
                const hostHandle = await handle.evaluateHandle((el: Element) => {
                    const root = el.getRootNode();
                    if (root instanceof ShadowRoot) {
                        return root.host;
                    }
                    return el;
                });
                // Use the host element for selector generation
                const hostElement = hostHandle.asElement();
                if (hostElement) {
                    selectorHandle = hostElement as unknown as typeof handle;
                    ax_node_meta.description = `Shadow DOM promoted: original role was ${ax_node_meta.role}, targeting host element`;
                }
            }

            const elementFrame = selectorHandle.frame;
            const uniqueStrategies = await generateSelectorsForElement(selectorHandle, elementFrame);

            // Generate frame selectors pathway if element is inside an iframe
            const frameSelectors: string[] = [];
            const mainFrame = request.page.pptrPage.mainFrame();
            let currentFrame = elementFrame;
            const framePath: Frame[] = [];

            while (currentFrame && currentFrame !== mainFrame) {
                framePath.unshift(currentFrame);
                const parent = currentFrame.parentFrame();
                if (!parent) {
                    break;
                }
                currentFrame = parent;
            }

            let parentFrame = mainFrame;
            for (const frame of framePath) {
                const frameElementHandle = await frame.frameElement();
                if (frameElementHandle) {
                    const iframeStrategies = await generateSelectorsForElement(frameElementHandle, parentFrame);
                    const bestIframeSelector = iframeStrategies.length > 0 ? iframeStrategies[0].value : '';
                    if (bestIframeSelector) {
                        frameSelectors.push(bestIframeSelector);
                    }
                }
                parentFrame = frame;
            }

            const best_selector = uniqueStrategies.length > 0 ? uniqueStrategies[0].value : '';

            selectorsData = {
                best_selector,
                strategies: uniqueStrategies,
                ax_node_meta,
                frame_selectors: frameSelectors.length > 0 ? frameSelectors : undefined,
            };

            void handle.dispose();
        } else if (requiresElement) {
            throw new Error(`Action "${action}" requires a uid parameter to identify the target element.`);
        }

        // Determine step_order
        let finalStepOrder = step_order;

        if (finalStepOrder === undefined) {
            // Get the max step_order for this workflow
            const { data: maxStepData } = await supabase
                .from('workflow_steps')
                .select('step_order')
                .eq('workflow_id', workflow_id)
                .order('step_order', { ascending: false })
                .limit(1)
                .single();

            finalStepOrder = maxStepData ? maxStepData.step_order + 1 : 1;
        }

        // Check if step_order already exists (upsert logic)
        const { data: existingStep } = await supabase
            .from('workflow_steps')
            .select('id')
            .eq('workflow_id', workflow_id)
            .eq('step_order', finalStepOrder)
            .single();

        let result;
        if (existingStep) {
            // Update existing step
            const { data, error } = await supabase
                .from('workflow_steps')
                .update({
                    action,
                    action_value,
                    description: step_description,
                    selectors: selectorsData,
                })
                .eq('id', existingStep.id)
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to update workflow step: ${error.message}`);
            }
            result = data;
            response.appendResponseLine(`Successfully updated step ${finalStepOrder} in workflow ${workflow_id}`);
        } else {
            // Insert new step
            const { data, error } = await supabase
                .from('workflow_steps')
                .insert([{
                    workflow_id,
                    step_order: finalStepOrder,
                    action,
                    action_value,
                    description: step_description,
                    selectors: selectorsData,
                }])
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to add workflow step: ${error.message}`);
            }
            result = data;
            response.appendResponseLine(`Successfully added step ${finalStepOrder} to workflow ${workflow_id}`);
        }

        response.appendResponseLine(`Action: ${result.action}`);
        if (selectorsData) {
            response.appendResponseLine(`Best selector: ${selectorsData.best_selector}`);
            response.appendResponseLine(`Selector strategies count: ${selectorsData.strategies.length}`);
        } else {
            response.appendResponseLine(`No selectors (element not required for this action)`);
        }
    },
});

export const addUrlToWhitelist = defineTool({
    name: 'add_url_to_whitelist',
    description: 'Adds a URL or domain to the whitelist.json file to allow navigation.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        url: zod.string().describe('The URL or domain to add to the whitelist, e.g., "google.com" or "https://api.github.com"'),
    },
    handler: async (request, response) => {
        const { url } = request.params;
        const hostname = validateWhitelistAddition(url);

        const whitelistPath = path.resolve(process.cwd(), 'whitelist.json');
        let whitelist: string[] = [];
        try {
            const data = await fs.readFile(whitelistPath, 'utf8');
            whitelist = JSON.parse(data);
            if (!Array.isArray(whitelist)) {
                whitelist = [];
            }
        } catch (e) {
            // File doesn't exist or is invalid, start fresh
        }

        if (!whitelist.includes(hostname)) {
            whitelist.push(hostname);
            await fs.writeFile(whitelistPath, JSON.stringify(whitelist, null, 2), 'utf8');
            response.appendResponseLine(`Added ${hostname} to whitelist by creating or updating whitelist.json.`);
        } else {
            response.appendResponseLine(`${hostname} is already in the whitelist.json.`);
        }
    },
});


// Human-like timing utilities
function gaussianRandom(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}

function humanDelay(baseMs: number, variance = 0.3): number {
    const min = baseMs * (1 - variance);
    const max = baseMs * (1 + variance);
    return Math.floor(gaussianRandom((min + max) / 2, (max - min) / 6));
}

function getThinkingDelay(): number {
    // Human "thinking" pause before action: 150-600ms
    return humanDelay(350, 0.5);
}

function getPostActionDelay(): number {
    // Pause after action to observe result: 200-800ms
    return humanDelay(450, 0.4);
}

function getTypingDelay(): number {
    // Delay between characters: 30-150ms (average 70ms)
    return humanDelay(70, 0.6);
}

function getMicroPause(): number {
    // Occasional micro-pause during typing: 100-300ms
    return Math.random() > 0.85 ? humanDelay(180, 0.5) : 0;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

// --- Natural mouse movement utilities ---

interface Point {
    x: number;
    y: number;
}

// Cubic Bezier interpolation: B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
        x: u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x,
        y: u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y,
    };
}

// Fitts's Law: T = a + b * log2(D / W + 1)
// a = base reaction time, b = movement coefficient, D = distance, W = target width
function fittsLawDuration(distance: number, targetWidth = 20): number {
    const a = 50;   // base time in ms
    const b = 150;  // movement coefficient in ms
    const indexOfDifficulty = Math.log2(distance / targetWidth + 1);
    const duration = a + b * indexOfDifficulty;
    // Add human variance
    return Math.max(80, humanDelay(duration, 0.2));
}

// Generate randomized Bezier control points that create a natural arc
function generateControlPoints(start: Point, end: Point): { cp1: Point; cp2: Point } {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Control point spread scales with distance but is capped
    const spread = Math.min(distance * 0.4, 200);

    // Perpendicular direction for arc offset
    const perpX = -dy / (distance || 1);
    const perpY = dx / (distance || 1);

    // Randomize arc direction and magnitude
    const arcOffset1 = gaussianRandom(0, spread * 0.5);
    const arcOffset2 = gaussianRandom(0, spread * 0.3);

    // CP1 at ~30% along the line, CP2 at ~70%
    const cp1: Point = {
        x: start.x + dx * 0.3 + perpX * arcOffset1 + gaussianRandom(0, spread * 0.1),
        y: start.y + dy * 0.3 + perpY * arcOffset1 + gaussianRandom(0, spread * 0.1),
    };
    const cp2: Point = {
        x: start.x + dx * 0.7 + perpX * arcOffset2 + gaussianRandom(0, spread * 0.1),
        y: start.y + dy * 0.7 + perpY * arcOffset2 + gaussianRandom(0, spread * 0.1),
    };

    return { cp1, cp2 };
}

// Move mouse naturally from current position to target using cubic Bezier + Fitts's Law
async function moveMouseNaturally(
    pageMouse: { move: (x: number, y: number) => Promise<void> },
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
): Promise<void> {
    const start: Point = { x: startX, y: startY };
    const end: Point = { x: targetX, y: targetY };

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Skip movement for very short distances
    if (distance < 3) {
        await pageMouse.move(end.x, end.y);
        return;
    }

    // Calculate movement duration using Fitts's Law
    const duration = fittsLawDuration(distance);

    // Generate Bezier control points for natural arc
    const { cp1, cp2 } = generateControlPoints(start, end);

    // Number of steps scales with distance and duration
    const stepCount = Math.max(10, Math.min(Math.ceil(distance / 5), 80));
    const stepDuration = duration / stepCount;

    // Ease-in-out: accelerate then decelerate (mimics real hand motion)
    for (let i = 1; i <= stepCount; i++) {
        // Use sinusoidal easing for natural acceleration/deceleration
        const rawT = i / stepCount;
        const easedT = 0.5 - 0.5 * Math.cos(Math.PI * rawT);

        const point = cubicBezier(easedT, start, cp1, cp2, end);

        // Dynamic micro-jitter: intensity varies by movement phase and distance
        // - Stronger in the middle of movement (hand vibration at speed)
        // - Weaker at start (initial aim) and near target (precision phase)
        // - Scales with total distance (longer moves = more hand instability)
        const phaseMultiplier = Math.sin(Math.PI * rawT); // 0 at edges, 1 at middle
        const distanceScale = Math.min(distance / 300, 1); // Caps at 300px
        const baseJitter = 0.3 + distanceScale * 1.2; // 0.3px to 1.5px base
        const jitterIntensity = baseJitter * phaseMultiplier;

        const jitterX = jitterIntensity > 0.1 ? gaussianRandom(0, jitterIntensity) : 0;
        const jitterY = jitterIntensity > 0.1 ? gaussianRandom(0, jitterIntensity) : 0;

        await pageMouse.move(
            Math.round(point.x + jitterX),
            Math.round(point.y + jitterY),
        );

        // Variable delay per step with slight randomness
        let delay = stepDuration * (0.8 + Math.random() * 0.4);

        // Occasional micro-pause: hand micro-correction (~3% chance)
        if (Math.random() < 0.03 && rawT > 0.2 && rawT < 0.8) {
            delay += humanDelay(40, 0.5);
        }

        await sleep(delay);
    }

    // Ensure we end exactly on target
    await pageMouse.move(Math.round(end.x), Math.round(end.y));
}

// Get a human-like click point within an element (biased toward center with Gaussian variance)
async function getElementClickPoint(
    element: ElementHandle,
): Promise<Point | null> {
    const box = await element.boundingBox();
    if (!box) return null;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Gaussian offset: ~68% of clicks land within stdDev of center
    // Use 15% of dimension as stdDev, clamped to stay inside element
    const offsetX = gaussianRandom(0, box.width * 0.15);
    const offsetY = gaussianRandom(0, box.height * 0.15);

    // Clamp to stay within ~85% of element bounds (safe inner area)
    const safeMarginX = box.width * 0.15;
    const safeMarginY = box.height * 0.15;

    return {
        x: Math.min(Math.max(centerX + offsetX, box.x + safeMarginX), box.x + box.width - safeMarginX),
        y: Math.min(Math.max(centerY + offsetY, box.y + safeMarginY), box.y + box.height - safeMarginY),
    };
}

// Scroll an element into view using mouse wheel with human-like incremental scrolling
async function scrollElementIntoView(
    pageMouse: { wheel: (options: { deltaY: number }) => Promise<void> },
    page: { evaluate: (fn: () => { viewportHeight: number; scrollY: number }) => Promise<{ viewportHeight: number; scrollY: number }> },
    element: ElementHandle,
): Promise<void> {
    const box = await element.boundingBox();
    if (!box) return;

    // Get viewport info
    const viewport = await page.evaluate(() => ({
        viewportHeight: window.innerHeight,
        scrollY: window.scrollY,
    }));

    const elementCenterY = box.y;
    const viewportHeight = viewport.viewportHeight;

    // Check if element is already reasonably visible (within 10%-90% of viewport)
    const visibleTop = viewportHeight * 0.1;
    const visibleBottom = viewportHeight * 0.9;
    if (elementCenterY >= visibleTop && elementCenterY + box.height <= visibleBottom) {
        return; // Already visible, no scroll needed
    }

    // Target position: bring element to a random spot in the upper-to-middle portion of viewport
    // Not always center — humans stop scrolling when they can see the element
    const targetViewportY = viewportHeight * (0.25 + Math.random() * 0.3); // Between 25%-55% of viewport
    const totalDelta = elementCenterY - targetViewportY;

    if (Math.abs(totalDelta) < 20) return; // Too small to bother

    // Scroll direction
    const direction = totalDelta > 0 ? 1 : -1;
    const absDelta = Math.abs(totalDelta);

    // Simulate mouse wheel with momentum physics
    // Phase 1: Active scrolling — strong impulses with variable deltaY
    let scrolled = 0;
    const impulseCount = Math.max(3, Math.ceil(absDelta / 150)); // Number of active scroll ticks
    const impulseDistance = absDelta * 0.75; // Cover ~75% with active impulses
    let velocity = 0;

    for (let i = 0; i < impulseCount && scrolled < impulseDistance; i++) {
        // Variable deltaY per tick: 80-180px with Gaussian distribution
        const tickSize = Math.min(
            Math.max(60, Math.floor(gaussianRandom(130, 30))),
            absDelta - scrolled,
        );

        await pageMouse.wheel({ deltaY: tickSize * direction });
        scrolled += tickSize;
        velocity = tickSize; // Track last impulse for momentum

        // Inter-tick delay: faster in the middle, slower at start
        const phase = i / impulseCount;
        const tickDelay = phase < 0.15 ? humanDelay(50, 0.4) : humanDelay(25, 0.5);
        await sleep(tickDelay);
    }

    // Phase 2: Momentum deceleration — wheel bleeds off speed naturally
    const friction = 0.92; // Deceleration per tick
    velocity = velocity * 0.6; // Initial momentum is weaker than active scrolling

    while (velocity > 8 && scrolled < absDelta) {
        const momentumTick = Math.min(
            Math.round(velocity),
            absDelta - scrolled,
        );

        if (momentumTick < 3) break;

        await pageMouse.wheel({ deltaY: momentumTick * direction });
        scrolled += momentumTick;

        velocity *= friction;

        // Momentum ticks get slower as energy dissipates
        await sleep(humanDelay(35, 0.3));
    }

    // Small settling pause after scrolling stops
    await sleep(humanDelay(180, 0.3));
}

// Track last known mouse position (starts roughly at center of viewport)
let lastMouseX = 400;
let lastMouseY = 300;

// Inject a symbolic cursor overlay that tracks mouse movements on the page
async function injectSymbolicCursor(page: Page): Promise<void> {
    await page.evaluate(() => {
        const existing = document.getElementById('__wf_cursor');
        if (existing) existing.remove();
        const existingStyle = document.getElementById('__wf_cursor_style');
        if (existingStyle) existingStyle.remove();

        const style = document.createElement('style');
        style.id = '__wf_cursor_style';
        style.textContent = `
            #__wf_cursor {
                position: fixed;
                width: 20px;
                height: 20px;
                pointer-events: none;
                z-index: 2147483647;
                transform: translate(-50%, -50%);
                transition: left 0.02s linear, top 0.02s linear;
            }
            #__wf_cursor_dot {
                width: 12px;
                height: 12px;
                background: radial-gradient(circle, #ef4444 0%, #dc2626 60%, transparent 100%);
                border-radius: 50%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 6px 2px rgba(239, 68, 68, 0.5);
            }
            #__wf_cursor_ring {
                width: 20px;
                height: 20px;
                border: 2px solid rgba(239, 68, 68, 0.4);
                border-radius: 50%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }
        `;
        document.head.appendChild(style);

        const cursor = document.createElement('div');
        cursor.id = '__wf_cursor';
        cursor.innerHTML = '<div id="__wf_cursor_ring"></div><div id="__wf_cursor_dot"></div>';
        cursor.style.left = '-100px';
        cursor.style.top = '-100px';
        document.body.appendChild(cursor);

        document.addEventListener('mousemove', (e: MouseEvent) => {
            const el = document.getElementById('__wf_cursor');
            if (el) {
                el.style.left = `${e.clientX}px`;
                el.style.top = `${e.clientY}px`;
            }
        });
    });
}

async function removeSymbolicCursor(page: Page): Promise<void> {
    await page.evaluate(() => {
        const cursor = document.getElementById('__wf_cursor');
        if (cursor) cursor.remove();
        const style = document.getElementById('__wf_cursor_style');
        if (style) style.remove();
    });
}


interface WorkflowStep {
    id: number;
    step_order: number;
    action: string;
    action_value: string | null;
    description: string | null;
    selectors: SelectorsData | null;
}

async function findElementByStrategies(
    page: Page | Frame,
    strategies: SelectorStrategy[],
): Promise<{ element: ElementHandle; usedStrategy: SelectorStrategy } | null> {
    for (const strategy of strategies) {
        try {
            let element: ElementHandle | null = null;

            if (strategy.type === 'xpath' || strategy.type === 'text') {
                // XPath selectors
                const elements = await page.$x(strategy.value);
                if (elements.length > 0) {
                    element = elements[0];
                }
            } else {
                // CSS selectors
                element = await page.$(strategy.value);
            }

            if (element) {
                return { element, usedStrategy: strategy };
            }
        } catch {
            // Strategy failed, try next
            continue;
        }
    }
    return null;
}

// Keyboard layout for adjacent key typo simulation
const ADJACENT_KEYS: Record<string, string[]> = {
    q: ['w', 'a'], w: ['q', 'e', 's', 'a'], e: ['w', 'r', 'd', 's'],
    r: ['e', 't', 'f', 'd'], t: ['r', 'y', 'g', 'f'], y: ['t', 'u', 'h', 'g'],
    u: ['y', 'i', 'j', 'h'], i: ['u', 'o', 'k', 'j'], o: ['i', 'p', 'l', 'k'],
    p: ['o', 'l'], a: ['q', 'w', 's', 'z'], s: ['a', 'w', 'e', 'd', 'z', 'x'],
    d: ['s', 'e', 'r', 'f', 'x', 'c'], f: ['d', 'r', 't', 'g', 'c', 'v'],
    g: ['f', 't', 'y', 'h', 'v', 'b'], h: ['g', 'y', 'u', 'j', 'b', 'n'],
    j: ['h', 'u', 'i', 'k', 'n', 'm'], k: ['j', 'i', 'o', 'l', 'm'],
    l: ['k', 'o', 'p'], z: ['a', 's', 'x'], x: ['z', 's', 'd', 'c'],
    c: ['x', 'd', 'f', 'v'], v: ['c', 'f', 'g', 'b'], b: ['v', 'g', 'h', 'n'],
    n: ['b', 'h', 'j', 'm'], m: ['n', 'j', 'k'],
    '1': ['2', 'q'], '2': ['1', '3', 'w'], '3': ['2', '4', 'e'],
    '4': ['3', '5', 'r'], '5': ['4', '6', 't'], '6': ['5', '7', 'y'],
    '7': ['6', '8', 'u'], '8': ['7', '9', 'i'], '9': ['8', '0', 'o'],
    '0': ['9', 'p'],
};

function getAdjacentTypo(char: string): string | null {
    const lower = char.toLowerCase();
    const adjacents = ADJACENT_KEYS[lower];
    if (!adjacents || adjacents.length === 0) return null;
    const typo = adjacents[Math.floor(Math.random() * adjacents.length)];
    // Preserve case
    return char === char.toUpperCase() && char !== char.toLowerCase()
        ? typo.toUpperCase()
        : typo;
}

// Key hold duration: time between keydown and keyup (60-120ms typical)
function getKeyHoldDuration(): number {
    return Math.max(40, Math.floor(gaussianRandom(85, 18)));
}

// Inter-key delay: time between releasing one key and pressing the next
// Average ~55 WPM ≈ ~220ms per character including hold time
function getInterKeyDelay(prevChar: string, nextChar: string): number {
    let base = 100; // Base inter-key gap in ms

    // Space after a word — slightly faster (finger is already on spacebar)
    if (nextChar === ' ') {
        base = 70;
    }
    // After space — brief pause starting a new word
    else if (prevChar === ' ') {
        base = 120;
    }
    // Same key repeated — slightly slower (double-tap)
    else if (prevChar.toLowerCase() === nextChar.toLowerCase()) {
        base = 140;
    }

    return Math.max(30, Math.floor(gaussianRandom(base, base * 0.35)));
}

interface RealisticKeyboard {
    down: (key: KeyInput) => Promise<void>;
    up: (key: KeyInput) => Promise<void>;
}

async function typeHumanLike(
    keyboard: RealisticKeyboard,
    text: string,
): Promise<void> {
    const TYPO_RATE = 0.04; // 4% chance of typo per character

    let prevChar = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // Inter-key delay (skip for first character)
        if (i > 0) {
            const interDelay = getInterKeyDelay(prevChar, char);
            await sleep(interDelay);
        }

        // Word boundary micro-pause: ~15% chance of a longer "thinking" pause after space
        if (prevChar === ' ' && Math.random() < 0.15) {
            await sleep(humanDelay(250, 0.5));
        }

        // Typo simulation: occasionally type a wrong adjacent key
        const isAlphanumeric = /[a-zA-Z0-9]/.test(char);
        if (isAlphanumeric && Math.random() < TYPO_RATE) {
            const typoChar = getAdjacentTypo(char);
            if (typoChar) {
                // Type the wrong key
                await pressKey(keyboard, typoChar as KeyInput);

                // Pause to "notice" the mistake (150-500ms)
                await sleep(humanDelay(300, 0.4));

                // Backspace to delete the typo
                await keyboard.down('Backspace' as KeyInput);
                await sleep(getKeyHoldDuration());
                await keyboard.up('Backspace' as KeyInput);

                // Short pause before retyping
                await sleep(humanDelay(80, 0.3));

                // Now type the correct key
                await pressKey(keyboard, char as KeyInput);
                prevChar = char;
                continue;
            }
        }

        // Normal key press
        await pressKey(keyboard, char as KeyInput);
        prevChar = char;
    }
}

// Press a single character with proper keydown/keyup timing and shift handling
async function pressKey(
    keyboard: RealisticKeyboard,
    char: KeyInput,
): Promise<void> {
    const isUpperCase = char !== char.toLowerCase() && char === char.toUpperCase();
    const isShiftSymbol = '~!@#$%^&*()_+{}|:"<>?'.includes(char);
    const needsShift = isUpperCase || isShiftSymbol;

    if (needsShift) {
        // Press Shift first
        await keyboard.down('ShiftLeft' as KeyInput);
        // Small delay between shift down and key down (30-70ms)
        await sleep(Math.max(20, Math.floor(gaussianRandom(45, 12))));
    }

    // Key down
    await keyboard.down(char);
    // Hold the key
    await sleep(getKeyHoldDuration());
    // Key up
    await keyboard.up(char);

    if (needsShift) {
        // Small delay before releasing shift (20-50ms)
        await sleep(Math.max(15, Math.floor(gaussianRandom(35, 10))));
        await keyboard.up('ShiftLeft' as KeyInput);
    }
}


const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function resolveVariables(
    template: string,
    variables: Record<string, string>,
): string {
    return template.replace(VARIABLE_PATTERN, (_match, varName: string) => {
        return variables[varName];
    });
}

async function withPulseFrame<T>(page: Page, actionFn: () => Promise<T>): Promise<T> {
    try {
        await page.evaluate(() => {
            if (!document.getElementById('__wf_pulse_style')) {
                const style = document.createElement('style');
                style.id = '__wf_pulse_style';
                style.textContent = `
                  @keyframes __wf_pulse {
                    0% { box-shadow: inset 0 0 0 0 rgba(239, 68, 68, 0.4); border-color: rgba(239, 68, 68, 0.4); }
                    50% { box-shadow: inset 0 0 20px 5px rgba(239, 68, 68, 0.8); border-color: rgba(239, 68, 68, 1); }
                    100% { box-shadow: inset 0 0 0 0 rgba(239, 68, 68, 0.4); border-color: rgba(239, 68, 68, 0.4); }
                  }
                `;
                document.head.appendChild(style);
            }

            let overlay = document.getElementById('__wf_pulse_overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = '__wf_pulse_overlay';
                overlay.style.position = 'fixed';
                overlay.style.top = '0';
                overlay.style.left = '0';
                overlay.style.width = '100vw';
                overlay.style.height = '100vh';
                overlay.style.pointerEvents = 'none';
                overlay.style.zIndex = '2147483646';
                overlay.style.boxSizing = 'border-box';
                overlay.style.border = '5px solid rgba(239, 68, 68, 0.8)';
                overlay.style.animation = '__wf_pulse 1.5s infinite';
                document.body.appendChild(overlay);
            }
        });
    } catch (e) {
        // Ignore injection failure (e.g. context destroyed)
    }

    try {
        return await actionFn();
    } finally {
        try {
            await page.evaluate(() => {
                const overlay = document.getElementById('__wf_pulse_overlay');
                if (overlay) overlay.remove();
                const style = document.getElementById('__wf_pulse_style');
                if (style) style.remove();
            });
        } catch (e) {
            // Ignore cleanup failure
        }
    }
}

export const runWorkflow = definePageTool({
    name: 'run_workflow',
    description: 'Runs a workflow or a specific step. Executes actions with human-like timing and robust selector fallbacks. Use {{variable_name}} in action_value and pass runtime values via the variables parameter.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        workflow_id: zod.number().describe('The ID of the workflow to run'),
        step_order: zod.number().optional().describe('If provided, only this specific step will be executed'),
        variables: zod.record(zod.string(), zod.string()).optional().describe('Key-value pairs to resolve {{variable_name}} placeholders in action_value fields. Example: {"username": "john", "password": "secret"}'),
    },
    handler: async (request, response, context) => {
        const page = request.page;
        return withPulseFrame(page.pptrPage, async () => {
            const { workflow_id, step_order, variables } = request.params;
            const vars: Record<string, string> = variables || {};

            // Fetch workflow and steps
            let query = supabase
                .from('workflow_steps')
                .select('*')
                .eq('workflow_id', workflow_id)
                .order('step_order', { ascending: true });

            if (step_order !== undefined) {
                query = query.eq('step_order', step_order);
            }

            const { data: steps, error } = await query;

            if (error) {
                throw new Error(`Failed to fetch workflow steps: ${error.message}`);
            }

            if (!steps || steps.length === 0) {
                response.appendResponseLine(
                    step_order !== undefined
                        ? `No step found with order ${step_order} in workflow ${workflow_id}`
                        : `No steps found for workflow ${workflow_id}`,
                );
                return;
            }

            const executionResults: Array<{ step: number; action: string; success: boolean; details: string }> = [];

        // Inject symbolic cursor for visual tracking
        await injectSymbolicCursor(page.pptrPage);

        // Pre-execution variable validation: scan all steps for required variables
        const missingVariables: Array<{ variable: string; stepOrder: number; description: string }> = [];
        for (const step of steps as WorkflowStep[]) {
            if (step.action_value) {
                VARIABLE_PATTERN.lastIndex = 0;
                let match = VARIABLE_PATTERN.exec(step.action_value);
                while (match) {
                    const varName = match[1];
                    if (vars[varName] === undefined) {
                        missingVariables.push({
                            variable: varName,
                            stepOrder: step.step_order,
                            description: step.description || step.action,
                        });
                    }
                    match = VARIABLE_PATTERN.exec(step.action_value);
                }
            }
        }

        if (missingVariables.length > 0) {
            response.appendResponseLine('❌ Missing required variables:');
            for (const mv of missingVariables) {
                response.appendResponseLine(`  • "${mv.variable}" — Step ${mv.stepOrder}: ${mv.description}`);
            }
            response.appendResponseLine('\nPlease provide these variables and try again.');
            return;
        }

        for (const step of steps as WorkflowStep[]) {
            response.appendResponseLine(`\n▶ Executing step ${step.step_order}: ${step.action}`);
            if (step.description) {
                response.appendResponseLine(`  Description: ${step.description}`);
            }

            // Human-like thinking pause before action
            await sleep(getThinkingDelay());

            // Resolve template variables in action_value
            let actionValue = step.action_value;
            if (actionValue && VARIABLE_PATTERN.test(actionValue)) {
                // Reset lastIndex since we use global flag
                VARIABLE_PATTERN.lastIndex = 0;
                actionValue = resolveVariables(actionValue, vars);
            }

            try {
                switch (step.action) {
                    case 'click': {
                        if (!step.selectors?.strategies) {
                            throw new Error('No selectors available for click action');
                        }

                        const targetFrame = await resolveFrame(page.pptrPage, step.selectors.frame_selectors);
                        const result = await findElementByStrategies(
                            targetFrame,
                            step.selectors.strategies,
                        );

                        if (!result) {
                            throw new Error('Element not found with any selector strategy');
                        }

                        response.appendResponseLine(`  Using selector: ${result.usedStrategy.type} = "${result.usedStrategy.value}"`);

                        const elementHandle = result.element;

                        // Scroll element into view naturally before interaction
                        await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, elementHandle);

                        // Natural mouse movement to element, then click
                        const center = await getElementClickPoint(elementHandle);
                        if (!center) {
                            throw new Error('Could not determine element position for click');
                        }

                        await page.waitForEventsAfterAction(async () => {
                            // Move mouse naturally along a Bezier curve
                            await moveMouseNaturally(
                                page.pptrPage.mouse,
                                lastMouseX, lastMouseY,
                                center.x, center.y,
                            );
                            lastMouseX = center.x;
                            lastMouseY = center.y;

                            // Hover dwell: user reads/confirms before clicking (100-300ms)
                            await sleep(humanDelay(180, 0.4));

                            // Natural mousedown → hold → mouseup
                            await page.pptrPage.mouse.down();
                            await sleep(Math.max(50, Math.floor(gaussianRandom(105, 25)))); // Hold 50-150ms
                            await page.pptrPage.mouse.up();
                        });

                        executionResults.push({ step: step.step_order, action: 'click', success: true, details: `Clicked using ${result.usedStrategy.type}` });
                        break;
                    }

                    case 'type': {
                        if (!actionValue) {
                            throw new Error('No text value provided for type action');
                        }

                        if (step.selectors?.strategies) {
                            const targetFrame = await resolveFrame(page.pptrPage, step.selectors.frame_selectors);
                            const result = await findElementByStrategies(
                                targetFrame,
                                step.selectors.strategies,
                            );

                            if (result) {
                                const elementHandle = result.element;
                                // Scroll element into view naturally before interaction
                                await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, elementHandle);
                                const center = await getElementClickPoint(elementHandle);
                                if (center) {
                                    // Move mouse naturally to element, then click to focus
                                    await moveMouseNaturally(
                                        page.pptrPage.mouse,
                                        lastMouseX, lastMouseY,
                                        center.x, center.y,
                                    );
                                    lastMouseX = center.x;
                                    lastMouseY = center.y;

                                    await page.waitForEventsAfterAction(async () => {
                                        // Hover dwell before focus click
                                        await sleep(humanDelay(140, 0.4));
                                        await page.pptrPage.mouse.down();
                                        await sleep(Math.max(50, Math.floor(gaussianRandom(95, 20))));
                                        await page.pptrPage.mouse.up();
                                        await sleep(humanDelay(100, 0.3));
                                    });
                                }
                            }
                        }

                        // Focus-to-first-keystroke delay: natural pause after clicking before typing
                        await sleep(humanDelay(450, 0.4));

                        // Type with realistic human-like rhythm using keyboard.down/up
                        await typeHumanLike(
                            page.pptrPage.keyboard,
                            actionValue,
                        );

                        executionResults.push({ step: step.step_order, action: 'type', success: true, details: `Typed "${actionValue.substring(0, 20)}..."` });
                        break;
                    }

                    case 'wait': {
                        const waitTime = actionValue ? parseInt(actionValue, 10) : 1000;
                        // Add human variance to wait time
                        const actualWait = humanDelay(waitTime, 0.15);
                        response.appendResponseLine(`  Waiting ${actualWait}ms`);
                        await sleep(actualWait);

                        executionResults.push({ step: step.step_order, action: 'wait', success: true, details: `Waited ${actualWait}ms` });
                        break;
                    }

                    case 'scroll': {
                        const scrollAmount = actionValue ? parseInt(actionValue, 10) : 300;
                        // Smooth scroll with increments
                        const scrollSteps = Math.ceil(Math.abs(scrollAmount) / 100);
                        const scrollIncrement = scrollAmount / scrollSteps;

                        for (let i = 0; i < scrollSteps; i++) {
                            await page.pptrPage.evaluate((amount: number) => {
                                window.scrollBy({ top: amount, behavior: 'smooth' });
                            }, scrollIncrement);
                            await sleep(humanDelay(80, 0.4));
                        }

                        executionResults.push({ step: step.step_order, action: 'scroll', success: true, details: `Scrolled ${scrollAmount}px` });
                        break;
                    }

                    case 'nav': {
                        if (!actionValue) {
                            throw new Error('No URL provided for nav action');
                        }

                        await checkNavigationSecurity(actionValue);

                        response.appendResponseLine(`  Navigating to: ${actionValue}`);

                        // Use waitForEventsAfterAction for navigation
                        await page.waitForEventsAfterAction(async () => {
                            await page.pptrPage.goto(actionValue, { waitUntil: 'networkidle2' });
                        });

                        // Wait for page to settle
                        await sleep(humanDelay(800, 0.3));

                        // Re-inject symbolic cursor and pulse overlay (destroyed by navigation)
                        await injectSymbolicCursor(page.pptrPage);
                        try {
                            await page.pptrPage.evaluate(() => {
                                if (!document.getElementById('__wf_pulse_style')) {
                                    const style = document.createElement('style');
                                    style.id = '__wf_pulse_style';
                                    style.textContent = `
                                      @keyframes __wf_pulse {
                                        0% { box-shadow: inset 0 0 0 0 rgba(239, 68, 68, 0.4); border-color: rgba(239, 68, 68, 0.4); }
                                        50% { box-shadow: inset 0 0 20px 5px rgba(239, 68, 68, 0.8); border-color: rgba(239, 68, 68, 1); }
                                        100% { box-shadow: inset 0 0 0 0 rgba(239, 68, 68, 0.4); border-color: rgba(239, 68, 68, 0.4); }
                                      }
                                    `;
                                    document.head.appendChild(style);
                                }
                                let overlay = document.getElementById('__wf_pulse_overlay');
                                if (!overlay) {
                                    overlay = document.createElement('div');
                                    overlay.id = '__wf_pulse_overlay';
                                    overlay.style.position = 'fixed';
                                    overlay.style.top = '0';
                                    overlay.style.left = '0';
                                    overlay.style.width = '100vw';
                                    overlay.style.height = '100vh';
                                    overlay.style.pointerEvents = 'none';
                                    overlay.style.zIndex = '2147483646';
                                    overlay.style.boxSizing = 'border-box';
                                    overlay.style.border = '5px solid rgba(239, 68, 68, 0.8)';
                                    overlay.style.animation = '__wf_pulse 1.5s infinite';
                                    document.body.appendChild(overlay);
                                }
                            });
                        } catch (e) {
                            // Ignore re-injection failure
                        }

                        executionResults.push({ step: step.step_order, action: 'nav', success: true, details: `Navigated to ${actionValue}` });
                        break;
                    }

                    case 'hover': {
                        if (!step.selectors?.strategies) {
                            throw new Error('No selectors available for hover action');
                        }

                        const targetFrame = await resolveFrame(page.pptrPage, step.selectors.frame_selectors);
                        const result = await findElementByStrategies(
                            targetFrame,
                            step.selectors.strategies,
                        );

                        if (!result) {
                            throw new Error('Element not found for hover action');
                        }

                        const elementHandle = result.element;

                        // Scroll element into view naturally before interaction
                        await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, elementHandle);

                        // Natural mouse movement to element for hover
                        const center = await getElementClickPoint(elementHandle);
                        if (!center) {
                            throw new Error('Could not determine element position for hover');
                        }

                        await page.waitForEventsAfterAction(async () => {
                            await moveMouseNaturally(
                                page.pptrPage.mouse,
                                lastMouseX, lastMouseY,
                                center.x, center.y,
                            );
                            lastMouseX = center.x;
                            lastMouseY = center.y;
                        });

                        // Hold hover for a moment
                        await sleep(humanDelay(400, 0.3));

                        executionResults.push({ step: step.step_order, action: 'hover', success: true, details: `Hovered using ${result.usedStrategy.type}` });
                        break;
                    }

                    case 'extract': {
                        if (!step.selectors?.strategies) {
                            throw new Error('No selectors available for extract action');
                        }

                        const targetFrame = await resolveFrame(page.pptrPage, step.selectors.frame_selectors);
                        const result = await findElementByStrategies(
                            targetFrame,
                            step.selectors.strategies,
                        );

                        if (!result) {
                            throw new Error('Element not found for extract action');
                        }

                        const elementHandle = result.element;
                        const extractedText = await elementHandle.evaluate((el: Element) => el.textContent || '');
                        response.appendResponseLine(`  Extracted: "${extractedText.trim().substring(0, 100)}"`);

                        executionResults.push({ step: step.step_order, action: 'extract', success: true, details: extractedText.trim().substring(0, 50) });
                        break;
                    }

                    case 'screenshot': {
                        const filename = actionValue || `workflow_${workflow_id}_step_${step.step_order}.png`;
                        const screenshot = await page.pptrPage.screenshot({ encoding: 'binary' });
                        await context.saveFile(screenshot as Uint8Array, filename);
                        response.appendResponseLine(`  Screenshot saved: ${filename}`);

                        executionResults.push({ step: step.step_order, action: 'screenshot', success: true, details: filename });
                        break;
                    }

                    case 'upload_image': {
                        if (!step.selectors?.strategies) {
                            throw new Error('No selectors available for upload_image action');
                        }
                        if (!actionValue) {
                            throw new Error('No image URL provided for upload_image action');
                        }

                        const targetFrame = await resolveFrame(page.pptrPage, step.selectors.frame_selectors);
                        const result = await findElementByStrategies(
                            targetFrame,
                            step.selectors.strategies,
                        );

                        if (!result) {
                            throw new Error('Element not found for upload_image action');
                        }

                        response.appendResponseLine(`  Downloading image from: ${actionValue}`);

                        // Download the image
                        const imageResponse = await fetch(actionValue);
                        if (!imageResponse.ok) {
                            throw new Error(`Failed to download image from ${actionValue}: ${imageResponse.statusText}`);
                        }
                        const arrayBuffer = await imageResponse.arrayBuffer();
                        const uint8Array = new Uint8Array(arrayBuffer);

                        // Save to temp file
                        const { filepath: filePath } = await context.saveTemporaryFile(uint8Array, 'image/png');

                        const uploadHandle = result.element;
                        try {
                            await (uploadHandle as unknown as { uploadFile: (path: string) => Promise<void> }).uploadFile(filePath);
                        } catch {
                            try {
                                const [fileChooser] = await Promise.all([
                                    page.pptrPage.waitForFileChooser({ timeout: 3000 }),
                                    uploadHandle.asLocator().click(),
                                ]);
                                await fileChooser.accept([filePath]);
                            } catch {
                                throw new Error(
                                    'Failed to upload image. The element could not accept the file directly, and clicking it did not trigger a file chooser.',
                                );
                            }
                        }

                        response.appendResponseLine(`  Image uploaded from ${filePath}`);
                        executionResults.push({ step: step.step_order, action: 'upload_image', success: true, details: `Uploaded image from ${actionValue}` });
                        break;
                    }

                    default:
                        throw new Error(`Unknown action type: ${step.action}`);
                }

                response.appendResponseLine(`  ✓ Step ${step.step_order} completed successfully`);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                response.appendResponseLine(`  ✗ Step ${step.step_order} failed: ${errorMessage}`);
                executionResults.push({ step: step.step_order, action: step.action, success: false, details: errorMessage });

                // Don't stop on error, continue with next step
                continue;
            }

            // Human-like pause after action
            await sleep(getPostActionDelay());
        }

        // Remove symbolic cursor
        await removeSymbolicCursor(page.pptrPage);

        // Summary
        response.appendResponseLine('\n--- Execution Summary ---');
        const successCount = executionResults.filter(r => r.success).length;
        response.appendResponseLine(`Total steps: ${executionResults.length}`);
        response.appendResponseLine(`Successful: ${successCount}`);
        response.appendResponseLine(`Failed: ${executionResults.length - successCount}`);
        });
    },
});

export const simulateWorkflow = definePageTool({
    name: 'simulate_workflow',
    description: 'Visually simulates a workflow without executing actions. Highlights target elements, moves the mouse naturally, and shows action labels so the user can preview workflow behavior.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: true,
    },
    schema: {
        workflow_id: zod.number().describe('The ID of the workflow to simulate'),
        step_order: zod.number().optional().describe('If provided, only this specific step will be simulated'),
        pause_ms: zod.number().optional().describe('Pause duration per step in milliseconds (default: 2000)'),
    },
    handler: async (request, response) => {
        const { workflow_id, step_order, pause_ms } = request.params;
        const pauseDuration = pause_ms || 2000;

        // Fetch workflow steps
        let query = supabase
            .from('workflow_steps')
            .select('*')
            .eq('workflow_id', workflow_id)
            .order('step_order', { ascending: true });

        if (step_order !== undefined) {
            query = query.eq('step_order', step_order);
        }

        const { data: steps, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch workflow steps: ${error.message}`);
        }

        if (!steps || steps.length === 0) {
            response.appendResponseLine('No steps found for simulation.');
            return;
        }

        const page = request.page.pptrPage;

        // Inject symbolic cursor for visual tracking
        await injectSymbolicCursor(page);

        // Inject simulation overlay styles once
        await page.evaluate(() => {
            const existingStyle = document.getElementById('__wf_sim_style');
            if (existingStyle) existingStyle.remove();

            const style = document.createElement('style');
            style.id = '__wf_sim_style';
            style.textContent = `
                @keyframes __wf_sim_pulse {
                    0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6); }
                    50% { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
                }
                .__wf_sim_highlight {
                    outline: 3px solid #6366f1 !important;
                    outline-offset: 2px !important;
                    animation: __wf_sim_pulse 1s ease-in-out infinite !important;
                    position: relative !important;
                    z-index: 999998 !important;
                }
                .__wf_sim_label {
                    position: fixed !important;
                    z-index: 999999 !important;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
                    color: #fff !important;
                    padding: 8px 16px !important;
                    border-radius: 8px !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                    font-size: 14px !important;
                    font-weight: 600 !important;
                    pointer-events: none !important;
                    white-space: nowrap !important;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.2) !important;
                    transition: opacity 0.3s ease !important;
                }
                .__wf_sim_banner {
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    z-index: 999999 !important;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
                    color: #fff !important;
                    padding: 20px 40px !important;
                    border-radius: 16px !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                    font-size: 18px !important;
                    font-weight: 700 !important;
                    text-align: center !important;
                    pointer-events: none !important;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
                }
            `;
            document.head.appendChild(style);
        });

        response.appendResponseLine(`🎬 Simulating workflow ${workflow_id} (${steps.length} steps)\n`);

        for (const step of steps as WorkflowStep[]) {
            const actionLabel = step.description || step.action;
            const actionValue = step.action_value || '';

            response.appendResponseLine(`▶ Step ${step.step_order}: ${step.action} — ${actionLabel}`);

            try {
                const elementActions = ['click', 'type', 'hover', 'extract', 'scroll', 'upload_image'];

                if (elementActions.includes(step.action) && step.selectors?.strategies) {
                    const targetFrame = await resolveFrame(page, step.selectors.frame_selectors);
                    // Find the target element
                    const result = await findElementByStrategies(
                        targetFrame,
                        step.selectors.strategies,
                    );

                    if (!result) {
                        response.appendResponseLine(`  ⚠ Element not found — skipping visual`);
                    } else {

                    const elementHandle = result.element;
                    const clickPoint = await getElementClickPoint(elementHandle);

                    // Ensure target frame has visual styles injected
                    await injectSimulationStyles(targetFrame);

                    // Highlight the element
                    await elementHandle.evaluate((el: Element) => {
                        el.classList.add('__wf_sim_highlight');
                    });

                    // Scroll element into view
                    await elementHandle.evaluate((el: Element) => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                    await sleep(400);

                    // Show action label near the element
                    const box = await elementHandle.boundingBox();
                    if (box) {
                        const labelText = step.action === 'type'
                            ? `⌨ TYPE: "${actionValue.substring(0, 30)}${actionValue.length > 30 ? '...' : ''}"`
                            : step.action === 'click'
                                ? '🖱 CLICK'
                                : step.action === 'hover'
                                    ? '🖱 HOVER'
                                    : step.action === 'extract'
                                        ? '📋 EXTRACT'
                                        : step.action === 'scroll'
                                            ? '↕ SCROLL'
                                            : step.action === 'upload_image'
                                                ? '📤 UPLOAD'
                                                : `⚡ ${step.action.toUpperCase()}`;

                        await page.evaluate((text: string, top: number, left: number) => {
                            const label = document.createElement('div');
                            label.className = '__wf_sim_label';
                            label.id = '__wf_sim_label';
                            label.textContent = text;
                            label.style.top = `${Math.max(8, top - 40)}px`;
                            label.style.left = `${left}px`;
                            document.body.appendChild(label);
                        }, labelText, box.y, box.x);
                    }

                    // Move mouse naturally to the element
                    if (clickPoint) {
                        await moveMouseNaturally(
                            page.mouse,
                            lastMouseX, lastMouseY,
                            clickPoint.x, clickPoint.y,
                        );
                        lastMouseX = clickPoint.x;
                        lastMouseY = clickPoint.y;
                    }

                    response.appendResponseLine(`  ✓ Element found (${result.usedStrategy.type})`);

                    // Pause for user observation
                    await sleep(pauseDuration);

                    // Remove highlight and label
                    await elementHandle.evaluate((el: Element) => {
                        el.classList.remove('__wf_sim_highlight');
                    });
                    await page.evaluate(() => {
                        const label = document.getElementById('__wf_sim_label');
                        if (label) label.remove();
                    });
                    }

                } else if (step.action === 'nav') {
                    // Navigation security check
                    if (!actionValue) {
                        response.appendResponseLine(`  ⚠ No URL provided for nav action`);
                    } else {
                        await checkNavigationSecurity(actionValue);
                        // Actually navigate to the URL
                        response.appendResponseLine(`  🌐 Navigating to: ${actionValue}`);
                        await page.goto(actionValue, { waitUntil: 'networkidle2' });
                        await sleep(humanDelay(800, 0.3));

                        // Re-inject cursor and simulation styles on the new page
                        await injectSymbolicCursor(page);
                    }

                } else if (step.action === 'wait') {
                    const waitMs = actionValue ? parseInt(actionValue, 10) : 1000;
                    await page.evaluate((ms: number) => {
                        const banner = document.createElement('div');
                        banner.className = '__wf_sim_banner';
                        banner.id = '__wf_sim_banner';
                        banner.textContent = `⏳ WAIT ${ms}ms`;
                        document.body.appendChild(banner);
                    }, waitMs);

                    response.appendResponseLine(`  ⏳ Would wait ${waitMs}ms`);
                    await sleep(Math.min(pauseDuration, 1500));

                    await page.evaluate(() => {
                        const banner = document.getElementById('__wf_sim_banner');
                        if (banner) banner.remove();
                    });

                } else if (step.action === 'screenshot') {
                    await page.evaluate(() => {
                        const banner = document.createElement('div');
                        banner.className = '__wf_sim_banner';
                        banner.id = '__wf_sim_banner';
                        banner.textContent = '📸 SCREENSHOT';
                        document.body.appendChild(banner);
                    });

                    response.appendResponseLine('  📸 Would take screenshot');
                    await sleep(Math.min(pauseDuration, 1500));

                    await page.evaluate(() => {
                        const banner = document.getElementById('__wf_sim_banner');
                        if (banner) banner.remove();
                    });
                }

            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                response.appendResponseLine(`  ✗ Simulation error: ${errorMessage}`);
            }

            // Short pause between steps
            await sleep(300);
        }

        // Clean up simulation styles and symbolic cursor
        await removeSymbolicCursor(page);
        await page.evaluate(() => {
            const style = document.getElementById('__wf_sim_style');
            if (style) style.remove();
        });

        response.appendResponseLine(`\n🎬 Simulation complete — ${steps.length} steps previewed`);
    },
});

export const clickLikeHuman = definePageTool({
    name: 'click_like_human',
    description: 'Clicks on an element with fully realistic human behavior: scrolls into view using mouse wheel with momentum, moves the cursor along a natural Bezier curve path, hovers briefly, then performs a mousedown/mouseup with natural hold timing. A symbolic cursor is displayed during the interaction. NOTE: Unless otherwise specified, prefer this tool over the standard click tool.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        uid: zod.string().describe('The uid of an element on the page from the page content snapshot'),
    },
    handler: async (request, response) => {
        const page = request.page;
        return withPulseFrame(page.pptrPage, async () => {
            const handle = await page.getElementByUid(request.params.uid);

        try {
            await injectSymbolicCursor(page.pptrPage);

            // Scroll element into view naturally
            await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, handle);

            // Get a natural click point within the element
            const clickPoint = await getElementClickPoint(handle);
            if (!clickPoint) {
                throw new Error('Could not determine element position');
            }

            // Move mouse naturally along a Bezier curve
            await moveMouseNaturally(
                page.pptrPage.mouse,
                lastMouseX, lastMouseY,
                clickPoint.x, clickPoint.y,
            );
            lastMouseX = clickPoint.x;
            lastMouseY = clickPoint.y;

            // Hover dwell: user reads/confirms before clicking
            await sleep(humanDelay(180, 0.4));

            // Natural mousedown → hold → mouseup
            await page.waitForEventsAfterAction(async () => {
                await page.pptrPage.mouse.down();
                await sleep(Math.max(50, Math.floor(gaussianRandom(105, 25))));
                await page.pptrPage.mouse.up();
            });

            await removeSymbolicCursor(page.pptrPage);

            response.appendResponseLine('Successfully clicked on the element with human-like behavior.');
        } catch (error) {
            await removeSymbolicCursor(page.pptrPage);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to click element: ${message}`);
        } finally {
            void handle.dispose();
        }
        });
    },
});

export const typeLikeHuman = definePageTool({
    name: 'type_like_human',
    description: 'Types text into an element with fully realistic human behavior: scrolls into view, moves the cursor naturally to the element, clicks to focus with natural mousedown/mouseup, pauses briefly, then types each character using keyboard.down/up with natural hold durations, inter-key delays matching ~55 WPM, Shift key handling for uppercase, and occasional typos that are corrected with Backspace. If uid is not provided, types into the currently focused element. NOTE: Unless otherwise specified, prefer this tool over the standard type tool.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        uid: zod.string().optional().describe('The uid of an element on the page from the page content snapshot. If not provided, types into the currently focused element.'),
        text: zod.string().describe('The text to type into the element'),
    },
    handler: async (request, response) => {
        const page = request.page;
        return withPulseFrame(page.pptrPage, async () => {
            const uid = request.params.uid;

            // If no uid, type directly into the focused element
            if (!uid) {
                await injectSymbolicCursor(page.pptrPage);
                await sleep(humanDelay(200, 0.4));
                await typeHumanLike(page.pptrPage.keyboard, request.params.text);
                await removeSymbolicCursor(page.pptrPage);

                const preview = request.params.text.length > 30
                    ? `${request.params.text.substring(0, 30)}...`
                    : request.params.text;
                response.appendResponseLine(`Successfully typed "${preview}" into the focused element with human-like behavior.`);
                return;
            }

            const handle = await page.getElementByUid(uid);

        try {
            await injectSymbolicCursor(page.pptrPage);

            // Scroll element into view naturally
            await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, handle);

            // Get a natural click point within the element
            const clickPoint = await getElementClickPoint(handle);
            if (!clickPoint) {
                throw new Error('Could not determine element position');
            }

            // Move mouse naturally along a Bezier curve
            await moveMouseNaturally(
                page.pptrPage.mouse,
                lastMouseX, lastMouseY,
                clickPoint.x, clickPoint.y,
            );
            lastMouseX = clickPoint.x;
            lastMouseY = clickPoint.y;

            // Hover dwell before focus click
            await sleep(humanDelay(140, 0.4));

            // Natural focus click: mousedown → hold → mouseup
            await page.waitForEventsAfterAction(async () => {
                await page.pptrPage.mouse.down();
                await sleep(Math.max(50, Math.floor(gaussianRandom(95, 20))));
                await page.pptrPage.mouse.up();
            });

            // Focus-to-first-keystroke delay
            await sleep(humanDelay(450, 0.4));

            // Type with realistic human-like rhythm
            await typeHumanLike(page.pptrPage.keyboard, request.params.text);

            await removeSymbolicCursor(page.pptrPage);

            const preview = request.params.text.length > 30
                ? `${request.params.text.substring(0, 30)}...`
                : request.params.text;
            response.appendResponseLine(`Successfully typed "${preview}" with human-like behavior.`);
        } catch (error) {
            await removeSymbolicCursor(page.pptrPage);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to type into element: ${message}`);
        } finally {
            void handle.dispose();
        }
        });
    },
});

export const clickAtLikeHuman = definePageTool({
    name: 'click_at_like_human',
    description: 'Clicks at the provided coordinates with fully realistic human behavior: moves the cursor along a natural Bezier curve path from its current position to the target coordinates, hovers briefly, then performs a mousedown/mouseup with natural hold timing. A symbolic cursor is displayed during the interaction. NOTE: Unless otherwise specified, prefer this tool over the standard click_at tool.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        x: zod.number().describe('The x coordinate'),
        y: zod.number().describe('The y coordinate'),
    },
    handler: async (request, response) => {
        const page = request.page;
        return withPulseFrame(page.pptrPage, async () => {
            const { x, y } = request.params;

        await injectSymbolicCursor(page.pptrPage);

        // Add slight human imprecision to coordinates
        const targetX = x + gaussianRandom(0, 1.5);
        const targetY = y + gaussianRandom(0, 1.5);

        // Move mouse naturally along a Bezier curve
        await moveMouseNaturally(
            page.pptrPage.mouse,
            lastMouseX, lastMouseY,
            targetX, targetY,
        );
        lastMouseX = targetX;
        lastMouseY = targetY;

        // Hover dwell: user confirms before clicking
        await sleep(humanDelay(180, 0.4));

        // Natural mousedown → hold → mouseup
        await page.waitForEventsAfterAction(async () => {
            await page.pptrPage.mouse.down();
            await sleep(Math.max(50, Math.floor(gaussianRandom(105, 25))));
            await page.pptrPage.mouse.up();
        });

        await removeSymbolicCursor(page.pptrPage);

        response.appendResponseLine(`Successfully clicked at (${Math.round(targetX)}, ${Math.round(targetY)}) with human-like behavior.`);
        });
    },
});

export const dragLikeHuman = definePageTool({
    name: 'drag_like_human',
    description: 'Drags an element onto another element with fully realistic human behavior: scrolls the source element into view, moves the cursor naturally to it, picks it up with a natural mousedown hold, then moves the cursor along a Bezier curve to the drop target and releases with mouseup. Includes pickup pause, natural trajectory, and drop settling. NOTE: Unless otherwise specified, prefer this tool over the standard drag tool.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        from_uid: zod.string().describe('The uid of the element to drag'),
        to_uid: zod.string().describe('The uid of the element to drop into'),
    },
    handler: async (request, response) => {
        const page = request.page;
        const fromHandle = await page.getElementByUid(request.params.from_uid);
        const toHandle = await page.getElementByUid(request.params.to_uid);

        try {
            await injectSymbolicCursor(page.pptrPage);

            // Scroll source element into view
            await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, fromHandle);

            // Get click point on source element
            const fromPoint = await getElementClickPoint(fromHandle);
            if (!fromPoint) {
                throw new Error('Could not determine source element position');
            }

            // Move mouse naturally to source element
            await moveMouseNaturally(
                page.pptrPage.mouse,
                lastMouseX, lastMouseY,
                fromPoint.x, fromPoint.y,
            );
            lastMouseX = fromPoint.x;
            lastMouseY = fromPoint.y;

            // Hover briefly before picking up
            await sleep(humanDelay(200, 0.4));

            // Mousedown to pick up — slightly longer hold than a click
            await page.pptrPage.mouse.down();
            await sleep(humanDelay(180, 0.3)); // Pickup pause: user grabs and holds

            // Scroll target into view if needed
            await scrollElementIntoView(page.pptrPage.mouse, page.pptrPage, toHandle);

            // Get drop point on target element
            const toPoint = await getElementClickPoint(toHandle);
            if (!toPoint) {
                await page.pptrPage.mouse.up();
                throw new Error('Could not determine target element position');
            }

            // Move mouse naturally to drop target while holding
            await moveMouseNaturally(
                page.pptrPage.mouse,
                lastMouseX, lastMouseY,
                toPoint.x, toPoint.y,
            );
            lastMouseX = toPoint.x;
            lastMouseY = toPoint.y;

            // Brief hover over drop target before releasing
            await sleep(humanDelay(150, 0.3));

            // Release: mouseup to drop
            await page.pptrPage.mouse.up();

            // Settling pause after drop
            await sleep(humanDelay(200, 0.3));

            await removeSymbolicCursor(page.pptrPage);

            response.appendResponseLine('Successfully dragged element with human-like behavior.');
        } catch (error) {
            await removeSymbolicCursor(page.pptrPage);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to drag element: ${message}`);
        } finally {
            void fromHandle.dispose();
            void toHandle.dispose();
        }
    },
});
