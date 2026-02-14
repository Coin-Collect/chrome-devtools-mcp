
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabase.js';
import { zod } from '../third_party/index.js';

import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';
import type { Context } from './ToolDefinition.js';

type Page = ReturnType<Context['getSelectedPage']>;
type ElementHandle = NonNullable<Awaited<ReturnType<Page['$']>>>;


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
}

export const addWorkflowStep = defineTool({
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
        action_value: zod.string().optional().describe('Value for the action (e.g., text to type, wait duration, URL for nav)'),
        step_description: zod.string().optional().describe('A description of what this step does'),
        step_order: zod.number().optional().describe('The order of this step. If not provided, will be set to last + 1. If exists, will update.'),
    },
    handler: async (request, response, context) => {
        const { workflow_id, action, uid, action_value, step_description, step_order } = request.params;

        // Actions that require an element
        const elementRequiredActions = ['click', 'type', 'hover', 'extract', 'scroll', 'upload_image'];
        const requiresElement = elementRequiredActions.includes(action);

        let selectorsData: SelectorsData | null = null;

        if (uid) {
            // Get element handle and AX node from snapshot
            const handle = await context.getElementByUid(uid);
            const node = context.getAXNodeByUid(uid);

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

            // Generate selector strategies using handle.evaluate
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

            // Sort by priority and pick best selector
            strategies.sort((a, b) => a.priority - b.priority);
            const best_selector = strategies.length > 0 ? strategies[0].value : '';

            selectorsData = {
                best_selector,
                strategies,
                ax_node_meta,
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

interface WorkflowStep {
    id: number;
    step_order: number;
    action: string;
    action_value: string | null;
    description: string | null;
    selectors: SelectorsData | null;
}

async function findElementByStrategies(
    page: { $: (selector: string) => Promise<unknown>; $x?: (xpath: string) => Promise<unknown[]> },
    strategies: SelectorStrategy[],
): Promise<{ element: ElementHandle; usedStrategy: SelectorStrategy } | null> {
    for (const strategy of strategies) {
        try {
            let element: unknown = null;

            if (strategy.type === 'xpath' || strategy.type === 'text') {
                // XPath selectors
                if (page.$x) {
                    const elements = await page.$x(strategy.value);
                    if (elements && elements.length > 0) {
                        element = elements[0];
                    }
                }
            } else {
                // CSS selectors
                element = await page.$(strategy.value);
            }

            if (element) {
                return { element: element as ElementHandle, usedStrategy: strategy };
            }
        } catch {
            // Strategy failed, try next
            continue;
        }
    }
    return null;
}

async function typeHumanLike(
    page: { keyboard: { type: (char: string) => Promise<void> } },
    text: string,
): Promise<void> {
    for (const char of text) {
        await sleep(getTypingDelay());
        await page.keyboard.type(char);
        await sleep(getMicroPause());
    }
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const DUMMY_VALUES: Record<string, string> = {
    email: 'user@example.com',
    username: 'testuser',
    password: 'Test1234!',
    name: 'John Doe',
    first_name: 'John',
    last_name: 'Doe',
    phone: '+1234567890',
    address: '123 Main Street',
    city: 'New York',
    zip: '10001',
    country: 'US',
    search: 'test query',
    url: 'https://example.com',
    message: 'Hello, this is a test message.',
    comment: 'This is a test comment.',
};

function getDummyValue(variableName: string): string {
    const lowerName = variableName.toLowerCase();
    // Try exact match first
    if (DUMMY_VALUES[lowerName]) {
        return DUMMY_VALUES[lowerName];
    }
    // Try partial match
    for (const [key, value] of Object.entries(DUMMY_VALUES)) {
        if (lowerName.includes(key) || key.includes(lowerName)) {
            return value;
        }
    }
    return `dummy_${variableName}`;
}

function resolveVariables(
    template: string,
    variables: Record<string, string>,
): { resolved: string; usedDummy: string[] } {
    const usedDummy: string[] = [];
    const resolved = template.replace(VARIABLE_PATTERN, (_match, varName: string) => {
        if (variables[varName] !== undefined) {
            return variables[varName];
        }
        usedDummy.push(varName);
        return getDummyValue(varName);
    });
    return { resolved, usedDummy };
}

export const runWorkflow = defineTool({
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

        const page = context.getSelectedPage();
        const executionResults: Array<{ step: number; action: string; success: boolean; details: string }> = [];

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
                const { resolved, usedDummy } = resolveVariables(actionValue, vars);
                actionValue = resolved;
                if (usedDummy.length > 0) {
                    response.appendResponseLine(`  ⚠ Using dummy values for: ${usedDummy.join(', ')}`);
                }
            }

            try {
                switch (step.action) {
                    case 'click': {
                        if (!step.selectors?.strategies) {
                            throw new Error('No selectors available for click action');
                        }

                        const result = await findElementByStrategies(
                            page as unknown as { $: (s: string) => Promise<unknown>; $x: (s: string) => Promise<unknown[]> },
                            step.selectors.strategies,
                        );

                        if (!result) {
                            throw new Error('Element not found with any selector strategy');
                        }

                        response.appendResponseLine(`  Using selector: ${result.usedStrategy.type} = "${result.usedStrategy.value}"`);

                        const elementHandle = result.element;

                        // Use waitForEventsAfterAction and asLocator() for better stability
                        await context.waitForEventsAfterAction(async () => {
                            const locator = elementHandle.asLocator();
                            await locator.hover();
                            await sleep(humanDelay(120, 0.3)); // Brief pause before click
                            await locator.click();
                        });

                        executionResults.push({ step: step.step_order, action: 'click', success: true, details: `Clicked using ${result.usedStrategy.type}` });
                        break;
                    }

                    case 'type': {
                        if (!actionValue) {
                            throw new Error('No text value provided for type action');
                        }

                        if (step.selectors?.strategies) {
                            const result = await findElementByStrategies(
                                page as unknown as { $: (s: string) => Promise<unknown>; $x: (s: string) => Promise<unknown[]> },
                                step.selectors.strategies,
                            );

                            if (result) {
                                const elementHandle = result.element;
                                await context.waitForEventsAfterAction(async () => {
                                    await elementHandle.asLocator().click(); // Focus by clicking
                                    await sleep(humanDelay(150, 0.3));
                                });
                            }
                        }

                        // Type with human-like rhythm
                        // Note: page.keyboard.type is not tied to a specific element handle, so we execute it on page.
                        await typeHumanLike(
                            page as unknown as { keyboard: { type: (char: string) => Promise<void> } },
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
                            await page.evaluate((amount: number) => {
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

                        response.appendResponseLine(`  Navigating to: ${actionValue}`);

                        // Use waitForEventsAfterAction for navigation
                        await context.waitForEventsAfterAction(async () => {
                            await page.goto(actionValue, { waitUntil: 'networkidle2' });
                        });

                        // Wait for page to settle
                        await sleep(humanDelay(800, 0.3));

                        executionResults.push({ step: step.step_order, action: 'nav', success: true, details: `Navigated to ${actionValue}` });
                        break;
                    }

                    case 'hover': {
                        if (!step.selectors?.strategies) {
                            throw new Error('No selectors available for hover action');
                        }

                        const result = await findElementByStrategies(
                            page as unknown as { $: (s: string) => Promise<unknown>; $x: (s: string) => Promise<unknown[]> },
                            step.selectors.strategies,
                        );

                        if (!result) {
                            throw new Error('Element not found for hover action');
                        }

                        const elementHandle = result.element;

                        await context.waitForEventsAfterAction(async () => {
                            await elementHandle.asLocator().hover();
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

                        const result = await findElementByStrategies(
                            page as unknown as { $: (s: string) => Promise<unknown>; $x: (s: string) => Promise<unknown[]> },
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
                        const screenshot = await page.screenshot({ encoding: 'binary' });
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

                        const result = await findElementByStrategies(
                            page as unknown as { $: (s: string) => Promise<unknown>; $x: (s: string) => Promise<unknown[]> },
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
                        const { filename: filePath } = await context.saveTemporaryFile(uint8Array, 'image/png');

                        const uploadHandle = result.element;
                        try {
                            await (uploadHandle as unknown as { uploadFile: (path: string) => Promise<void> }).uploadFile(filePath);
                        } catch {
                            try {
                                const [fileChooser] = await Promise.all([
                                    page.waitForFileChooser({ timeout: 3000 }),
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

        // Summary
        response.appendResponseLine('\n--- Execution Summary ---');
        const successCount = executionResults.filter(r => r.success).length;
        response.appendResponseLine(`Total steps: ${executionResults.length}`);
        response.appendResponseLine(`Successful: ${successCount}`);
        response.appendResponseLine(`Failed: ${executionResults.length - successCount}`);
    },
});

