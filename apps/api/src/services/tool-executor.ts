/**
 * Mock tool executor.
 *
 * In a real MCP-compliant gateway this layer would:
 *   1. Resolve the tool server via a registry (MCP server manifest).
 *   2. Open an MCP session (stdio or SSE transport).
 *   3. Call tools/call with validated arguments.
 *   4. Stream results back and aggregate.
 *
 * The mock returns deterministic, realistic-looking responses so the demo
 * does not require any external services or API keys.
 */

import type { GatewayInvokeRequest } from '@pgag/shared';

interface ToolResult {
  success: boolean;
  data: Record<string, unknown>;
  executionMs: number;
}

type ToolHandler = (args: Record<string, unknown>) => Record<string, unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  lookup_customer: (args) => ({
    customer_id: args['customer_id'] ?? 'cust-unknown',
    name: 'Elara Voss',
    email: 'elara.voss@example.com',
    plan: 'enterprise',
    mrr_usd: 4800,
    account_status: 'active',
    region: 'us-east-1',
    created_at: '2023-06-15T10:00:00Z',
  }),

  wire_transfer: (args) => ({
    transfer_id: `txn-${Math.random().toString(36).slice(2, 9)}`,
    status: 'completed',
    amount: args['amount'],
    account: args['account'],
    processed_at: new Date().toISOString(),
    reference: `REF-${Date.now()}`,
  }),

  send_email: (args) => ({
    message_id: `msg-${Math.random().toString(36).slice(2, 9)}`,
    status: 'queued',
    recipient: args['to'],
    subject: args['subject'],
    queued_at: new Date().toISOString(),
    estimated_delivery_ms: 3200,
  }),

  list_orders: (args) => ({
    orders: [
      { id: 'ord-001', status: 'shipped', total_usd: 249.99, placed_at: '2024-04-01' },
      { id: 'ord-002', status: 'processing', total_usd: 89.00, placed_at: '2024-04-15' },
    ],
    customer_id: args['customer_id'],
    total: 2,
  }),
};

const FALLBACK_HANDLER: ToolHandler = (args) => ({
  status: 'executed',
  tool: 'unknown',
  args,
  timestamp: new Date().toISOString(),
});

export async function executeTool(req: Pick<GatewayInvokeRequest, 'toolName' | 'toolArgs'>): Promise<ToolResult> {
  const start = Date.now();

  // Simulate realistic network/execution latency
  const simulatedLatencyMs = 40 + Math.floor(Math.random() * 120);
  await new Promise((r) => setTimeout(r, simulatedLatencyMs));

  const handler = TOOL_HANDLERS[req.toolName] ?? FALLBACK_HANDLER;

  try {
    const data = handler(req.toolArgs);
    return {
      success: true,
      data,
      executionMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      data: { error: String(err) },
      executionMs: Date.now() - start,
    };
  }
}
