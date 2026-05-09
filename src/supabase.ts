
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as os from 'node:os';
import * as path from 'node:path';

// Load .env from ~/rockstarx/ first, then let CWD .env override if present
dotenv.config({ path: path.join(os.homedir(), 'rockstarx', '.env') });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    'SUPABASE_URL or SUPABASE_KEY is missing. Supabase integration will not work.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
