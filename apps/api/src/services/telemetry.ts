import { v4 as uuidv4 } from 'uuid';

/**
 * Lightweight trace context following W3C traceparent format.
 *
 * In production, replace with @opentelemetry/sdk-node and configure an
 * OTLP exporter to send spans to Grafana Tempo, Jaeger, or Datadog APM.
 * The trace_id here maps directly to the W3C traceparent trace-id field.
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export function newTraceContext(parentTraceId?: string): TraceContext {
  return {
    traceId: parentTraceId ?? uuidv4().replace(/-/g, ''),
    spanId: uuidv4().replace(/-/g, '').slice(0, 16),
  };
}

export function parseTraceParent(header: string | undefined): string | undefined {
  if (!header) return undefined;
  // W3C traceparent: "00-{traceId}-{parentId}-{flags}"
  const parts = header.split('-');
  return parts.length >= 2 ? parts[1] : undefined;
}

export function buildTraceParent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-01`;
}

/**
 * Structured telemetry fields for every gateway event.
 * Emit via logger.info({ ...gatewayEvent(...) }) to produce queryable logs.
 */
export function gatewayEvent(fields: {
  event: string;
  traceId: string;
  requestId: string;
  tenantId: string;
  agentId: string;
  toolName: string;
  decision?: string;
  latencyMs?: number;
  costEstimate?: number;
  outcome?: string;
  [key: string]: unknown;
}) {
  return {
    ...fields,
    schema_version: '1.0',
  };
}
