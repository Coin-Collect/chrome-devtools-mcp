
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabase.js';
import { zod } from '../third_party/index.js';

import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

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
        action: zod.enum(['click', 'type', 'wait', 'scroll', 'nav', 'hover', 'extract', 'screenshot']).describe('The action type for this step'),
        uid: zod.string().describe('The uid of an element on the page from the page content snapshot'),
        action_value: zod.string().optional().describe('Value for the action (e.g., text to type, wait duration)'),
        step_description: zod.string().optional().describe('A description of what this step does'),
        step_order: zod.number().optional().describe('The order of this step. If not provided, will be set to last + 1. If exists, will update.'),
    },
    handler: async (request, response, context) => {
        const { workflow_id, action, uid, action_value, step_description, step_order } = request.params;

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

        const selectorsData: SelectorsData = {
            best_selector,
            strategies,
            ax_node_meta,
        };

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
        response.appendResponseLine(`Best selector: ${best_selector}`);
        response.appendResponseLine(`Selector strategies count: ${strategies.length}`);

        void handle.dispose();
    },
});
