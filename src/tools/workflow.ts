
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
