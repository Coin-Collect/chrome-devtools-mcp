
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
