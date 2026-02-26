
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    'SUPABASE_URL or SUPABASE_KEY is missing. Supabase integration will not work.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
