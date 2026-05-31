# Operability Guide

## Observability

### Structured Logging

Every request produces a structured JSON log line with fields that map directly to your log aggregator's query model:

```json
{
  "time": "2024-05-30T10:23:45.123Z",
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
  "cost_estimate": 0.000012,
  "schema_version": "1.0"
}
```

**Grafana Loki query to find all denied requests:**
```logql
{service="pgag-api"} | json | decision = "deny"
```

**Datadog APM query:**
```
@event:request.denied @tenant_id:tenant-acme-001
```

### Metrics

`GET /metrics` returns Prometheus-format text:

```
# TYPE pgag_gateway_requests_total counter
pgag_gateway_requests_total{tenant="tenant-acme-001",status="allowed"} 142
pgag_gateway_requests_total{tenant="tenant-acme-001",status="denied"} 18
pgag_gateway_requests_total{tenant="tenant-acme-001",status="approval_required"} 7

# TYPE pgag_gateway_request_duration_ms histogram
pgag_gateway_request_duration_ms_bucket{tenant="tenant-acme-001",le="100"} 121
pgag_gateway_request_duration_ms_sum{tenant="tenant-acme-001"} 11403
pgag_gateway_request_duration_ms_count{tenant="tenant-acme-001"} 167

# TYPE pgag_policy_decisions_total counter
pgag_policy_decisions_total{tenant="tenant-acme-001",decision="allow",tool="lookup_customer"} 142

# TYPE pgag_cost_usd_total counter
pgag_cost_usd_total{tenant="tenant-acme-001"} 0.001847
```

**Connecting to Prometheus:**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'pgag-api'
    static_configs:
      - targets: ['pgag-api:3000']
    metrics_path: /metrics
```

### Distributed Tracing

The gateway propagates W3C `traceparent` headers. To enable full distributed tracing:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
            @opentelemetry/exporter-trace-otlp-http
```

Then create `src/tracing.ts` and import before server start:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
});

sdk.start();
```

The `trace_id` in every log line and the `traceparent` header in every response will automatically correlate with your OpenTelemetry spans.

## Health Checks

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /health` | Liveness — is the process up? | `{"status":"ok"}` |
| `GET /ready` | Readiness — can it serve traffic? | `{"status":"ready","checks":{"database":"ok"}}` |
| `GET /metrics` | Prometheus scrape | Text metrics |

Kubernetes probe configuration is already included in the Helm chart.

## Runbooks

### High Error Rate

```bash
# Check recent errors
curl http://pgag-api/v1/audit-logs?action=request.error | jq

# Check DB connectivity
curl http://pgag-api/ready

# Tail structured logs
kubectl logs -l app=pgag-api --tail=100 | jq 'select(.level=="error")'
```

### Pending Approvals Accumulating

```bash
# List pending approvals via API
curl -H "X-API-Key: $API_KEY" http://pgag-api/v1/requests?status=approval_required

# Bulk-approve via script (add to ops tooling, not run ad-hoc in production)
```

### Rate Limit False Positives

Adjust `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` in environment config. Redis key pattern: `rl:{tenantId}:invoke`.

### Database Migrations

```bash
# Run migrations (idempotent)
pnpm db:migrate

# In Kubernetes — run as a Job before deployment
kubectl create job pgag-migrate --image=pgag-api -- node dist/db/migrate.js
```

## SLOs

Recommended SLO targets for production:

| Metric | Target |
|---|---|
| Gateway P99 latency | < 500ms |
| Availability | 99.9% |
| Policy evaluation time | < 50ms |
| Audit log write success | 100% |
| Rate limit false positive rate | < 0.1% |

## Capacity Planning

At 100 req/s sustained:
- PostgreSQL: ~200 writes/s (requests + audit logs + cost events) — single writer handles this easily
- Redis: ~200 ops/s for rate limiting — negligible for Redis
- API: ~100ms median latency → 2 replicas comfortably handle 100 req/s
- Cost events: ~50 rows/min at typical approval rates
