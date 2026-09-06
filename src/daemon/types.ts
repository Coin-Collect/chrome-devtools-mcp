/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type DaemonMessage =
  | {
      method: 'stop';
      authToken?: string;
  }
  | {
      method: 'status';
      authToken?: string;
  }
  | {
      method: 'invoke_tool';
      authToken?: string;
      tool: string;
      args?: Record<string, unknown>;
      timeoutMs?: number;
    };

export interface DaemonResponse {
  success: boolean;
  // Stringified CallToolResult.
  result: string;
  error: unknown;
}
