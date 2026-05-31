# Operability

## Health endpoints

| Endpoint | Purpose | What it checks |
|---|---|---|
| `GET /health` | Liveness — is the process running? | Always 200 if the server is up |
| `GET /ready` | Readiness — can it serve traffic? | Runs `SELECT 1` against PostgreSQL |
| `GET /metrics` | Prometheus scrape | In-process counters and histograms |

Kubernetes probes are pre-configured in the Helm chart values.

---

## Structured logging

Every gateway event writes one JSON line to stdout. These are designed to be consumed by any log aggregator.

```json
{
  "time": "2025-05-30T10:23:45.123Z",
  "level": "info",
  "msg": "Gateway request allowed and executed",
  "event": "request.allowed",
  "service": "pgag-api",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "tenant-acme-001",
  "agent_id": "agent-sales-001",
  "tool_name": "lookup_customer",
  "decision": "allow",
  "latency_ms": 87,
  "cost_estimate": 0.000012
}
```

**Key query patterns**

```logql
# Grafana Loki — all denied requests for a tenant
{service="pgag-api"} | json | decision="deny" | tenant_id="tenant-acme-001"

# Datadog — error rate by tool
@event:request.* @decision:deny | stats count by @tool_name

# CloudWatch Insights
fields @timestamp, tenant_id, tool_name, decision, latency_ms
| filter decision = "deny"
| sort @timestamp desc
```

---

## Metrics

`GET /metrics` returns Prometheus text format. Key metrics:

```
# Request throughput by decision outcome
pgag_gateway_requests_total{tenant,status}

# Latency distribution (histogram, ms)
pgag_gateway_request_duration_ms{tenant}

# Policy evaluation breakdown
pgag_policy_decisions_total{tenant,decision,tool}

# Successful tool executions
pgag_tool_executions_total{tenant,tool}

# Approval queue depth (should stay near 0 in steady state)
pgag_approvals_pending_total{tenant}

# Rate limiter health (should always be 0 in production)
pgag_ratelimiter_errors_total{tenant}
```

**Connecting to Prometheus**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: pgag
    static_configs:
      - targets: ['pgag-api:3000']
    metrics_path: /metrics
    scrape_interval: 30s
```

**Recommended Grafana panels**

- Request rate by decision (stacked bar: allow / deny / approval_required)
- P99 latency per tenant
- Approval queue depth over time
- Cost per tenant per day
- Rate limiter error count (alert if > 0 sustained)

---

## Distributed tracing

The gateway reads and propagates W3C `traceparent` headers. Every log line carries the same `trace_id`, making it trivial to correlate logs, spans, and database records for a single request.

**Enabling full span export (no code changes required)**

```bash
pnpm add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
         @opentelemetry/exporter-trace-otlp-http
```

Create `src/tracing.ts` and import before `server.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
}).start();
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` in the environment. The `trace_id` in all log lines and DB records maps directly to the OTLP trace ID — no additional correlation needed.

---

## SLOs

Recommended targets for a production deployment:

| Metric | Target | Alert threshold |
|---|---|---|
| Gateway P99 latency | < 200ms | > 500ms for 5 min |
| Availability | 99.9% | Any 5xx rate > 1% for 2 min |
| Policy evaluation time | < 50ms | > 200ms for 2 min |
| Audit log write success | 100% | Any failure → page |
| Approval queue depth | < 10 pending | > 50 pending for 10 min |
| Rate limiter error rate | 0 | Any sustained errors → alert |

---

## Runbooks

**High error rate**
```bash
# Check recent errors
curl -H "X-API-Key: $KEY" http://localhost:3000/v1/audit-logs?action=tool.executed | jq '.data[] | select(.outcome=="failure")'

# Check DB connectivity
curl http://localhost:3000/ready

# Tail structured error logs
docker compose logs api | grep '"level":"error"' | jq
```

**Approval queue growing**
```bash
# List pending approvals
curl -H "X-API-Key: $KEY" http://localhost:3000/v1/requests?status=approval_required | jq '.data[] | {id, agentName, toolName, createdAt}'
```

**Rate limiting false positives**
Adjust `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` in environment config. Current keys in Redis follow the pattern `rl:{tenantId}:invoke`.

**Database migrations**
```bash
# Idempotent — safe to run multiple times
pnpm db:migrate

# Kubernetes — run as an init container or pre-deploy Job
kubectl create job pgag-migrate --image=pgag-api:latest -- node dist/db/migrate.js
```

---

## Capacity planning

At sustained 100 req/s with 2 API replicas:

| Resource | Load | Headroom |
|---|---|---|
| PostgreSQL writes | ~300 writes/s (requests + audit + cost) | Single writer handles ~5,000/s |
| Redis ops | ~200 ops/s (rate limiting) | Negligible for Redis |
| API CPU | ~10% per replica | Scales horizontally via HPA |
| API memory | ~150 MB per replica | Static; no significant GC pressure |
