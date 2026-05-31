# policy-governed-ai-gateway

An AI agent control plane that enforces policy, requires human approval for high-risk operations, and writes an immutable audit trail for every tool call — before execution, not after.

> No paid API keys. No cloud account. Runs entirely on Docker Compose.

---

## The problem it solves

Autonomous agents need to call real tools — CRM reads, financial transfers, outbound email. Organizations cannot grant unconstrained access. The gap between "agent has an API key" and "agent operates safely in production" is a control plane:

- **Authentication** — which agent is calling, on behalf of which tenant?
- **Policy enforcement** — is this agent allowed to call this tool, under these conditions?
- **Human oversight** — some actions require a person to approve before execution
- **Audit trail** — what happened, who decided, when, and why?
- **Cost accounting** — how many tokens did each tenant's agents consume?

This project implements that control plane as a standalone gateway service.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent / Application                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │  POST /v1/gateway/invoke
                               │  X-API-Key: {tenant-key}
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Gateway API  (Fastify)                      │
│                                                                 │
│   authenticate → rate-limit → validate → resolve-agent          │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                   Policy Engine                          │  │
│   │   priority-sorted rules · fail-closed default            │  │
│   │   conditions: scope · amount · allowlist · blocklist     │  │
│   └────────────────────┬─────────────────────────────────────┘  │
│                        │                                        │
│          ┌─────────────┼──────────────┐                         │
│        allow         deny      approval_required                │
│          │             │              │                         │
│   execute tool     log & block    hold for review               │
│          │             │              │                         │
│          └─────────────┴──────────────┘                         │
│                        │                                        │
│          audit log · cost event · metrics · trace               │
└─────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
               PostgreSQL              Redis
               (state + audit)      (rate limiting)
                    │
                    ▼
            React Dashboard
            requests · approvals · audit · policies
```

**Request lifecycle**

| Step | What happens |
|---|---|
| Auth | API key validated against `tenants` table; tenant context attached |
| Rate limit | Redis sliding-window per tenant per endpoint (RFC 6585 headers set) |
| Validate | Zod schema; prototype-polluting keys (`__proto__` etc.) stripped |
| Agent resolve | `agentId` checked against `agents` table with tenant isolation |
| Write pending | `gateway_requests` row inserted with `status=pending` before evaluation |
| Policy evaluate | All tenant policies loaded, sorted by priority desc, conditions gated |
| Branch | `allow` → execute · `deny` → block · `approval_required` → hold |
| Audit | `audit_logs` row written for every state transition |
| Metrics | Prometheus counters and histograms updated |

---

## Policy engine

Policies are per-tenant JSON rules evaluated in priority order. **If no policy matches, the default is deny.** The first policy whose conditions all pass determines the outcome.

```jsonc
// Allow — CRM reads for agents with the right scope
{
  "toolName": "lookup_customer",
  "requiredScope": "crm:read",
  "decision": "allow",
  "reason": "CRM read access permitted",
  "priority": 10
}

// Deny — block high-value transfers regardless of scope
{
  "toolName": "wire_transfer",
  "maxAmount": 10000,
  "decision": "deny",
  "reason": "Transfers above $10,000 blocked by security policy",
  "priority": 30
}

// Approval required — hold outbound email for human review
{
  "toolName": "send_email",
  "requiredScope": "comms:send",
  "decision": "approval_required",
  "reason": "All outbound email requires human review before delivery",
  "priority": 10
}
```

Supported conditions: `requiredScope` · `maxAmount` · `allowedAgentIds` · `blockedAgentIds` · `priority` · `enabled`

---

## Demo scenarios

### 1 — Allowed ✅

**SalesBot** (`scopes: [crm:read]`) calls `lookup_customer`. Policy allows it.

```bash
curl -s -X POST http://localhost:3000/v1/gateway/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-tenant-key-acme" \
  -d '{"agentId":"agent-sales-001","toolName":"lookup_customer","toolArgs":{"customer_id":"cust-42"}}' \
  | jq '{decision, status, toolResult, costEstimate, latencyMs}'
```

```json
{
  "decision": "allow",
  "status": "allowed",
  "toolResult": { "name": "Elara Voss", "plan": "enterprise", "mrr_usd": 4800 },
  "costEstimate": 0.000012,
  "latencyMs": 87
}
```

### 2 — Denied 🚫

**FinanceBot** (`scopes: [finance:read]`) calls `wire_transfer`. Requires `finance:write`. Blocked.

```bash
curl -s -X POST http://localhost:3000/v1/gateway/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-tenant-key-acme" \
  -d '{"agentId":"agent-finance-001","toolName":"wire_transfer","toolArgs":{"amount":5000,"account":"ACC-999"}}' \
  | jq '{decision, status, reason}'
```

```json
{
  "decision": "deny",
  "status": "denied",
  "reason": "Agent lacks required scope 'finance:write' for tool 'wire_transfer'."
}
```

### 3 — Approval required ⏳

**MarketingBot** calls `send_email`. Policy requires human review before delivery.

```bash
# Step 1: invoke — returns 202 with approvalId
RESP=$(curl -s -X POST http://localhost:3000/v1/gateway/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-tenant-key-acme" \
  -d '{"agentId":"agent-marketing-001","toolName":"send_email","toolArgs":{"to":"vip@acme.com","subject":"Q2 Promo","body":"Hello"}}')

APPROVAL_ID=$(echo $RESP | jq -r '.approvalId')

# Step 2: approve from dashboard or API — executes the tool and writes full audit chain
curl -s -X POST http://localhost:3000/v1/approvals/$APPROVAL_ID/approve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-tenant-key-acme" \
  -d '{"comment": "Reviewed and approved"}' | jq '{status, toolResult}'
```

---

## Local setup

**Prerequisites:** Docker, Node.js ≥ 20, pnpm ≥ 9

```bash
git clone https://github.com/your-username/policy-governed-ai-gateway
cd policy-governed-ai-gateway

cp .env.example .env                   # defaults work as-is

pnpm install
pnpm docker:up                         # starts Postgres + Redis, waits for health checks
pnpm db:migrate                        # applies schema
pnpm db:seed                           # loads demo tenants, agents, and policies

pnpm --filter @pgag/api dev            # API at :3000
pnpm --filter @pgag/web dev            # Dashboard at :5173
```

Or with Docker Compose for everything:

```bash
pnpm docker:up
# API at :3000  ·  Dashboard at :5173
```

---

## API reference

```bash
export KEY="demo-tenant-key-acme"
export API="http://localhost:3000"

# Invoke the gateway
POST  $API/v1/gateway/invoke          -H "X-API-Key: $KEY"

# Read requests
GET   $API/v1/requests                -H "X-API-Key: $KEY"
GET   $API/v1/requests/:id            -H "X-API-Key: $KEY"

# Approvals
POST  $API/v1/approvals/:id/approve   -H "X-API-Key: $KEY"
POST  $API/v1/approvals/:id/deny      -H "X-API-Key: $KEY"

# Audit and policy
GET   $API/v1/audit-logs              -H "X-API-Key: $KEY"
GET   $API/v1/policies                -H "X-API-Key: $KEY"
POST  $API/v1/policies                -H "X-API-Key: $KEY"

# Observability (no auth required)
GET   $API/health
GET   $API/ready
GET   $API/metrics                    # Prometheus text format
```

---

## Testing

```bash
pnpm test                             # all packages
pnpm --filter @pgag/policy-engine test  # policy engine only (no DB)
pnpm --filter @pgag/api test            # API unit tests
```

**What's covered:** allow / deny / approval\_required decisions · tenant isolation (cross-tenant policy leakage) · amount threshold enforcement · priority ordering · fail-closed default · cost estimator · invalid request rejection

---

## Observability

### Structured logs

Every request emits one JSON line to stdout:

```json
{
  "time": "2025-05-30T10:23:45.123Z",
  "level": "info",
  "event": "request.allowed",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "tenant_id": "tenant-acme-001",
  "agent_id": "agent-sales-001",
  "tool_name": "lookup_customer",
  "decision": "allow",
  "latency_ms": 87,
  "cost_estimate": 0.000012
}
```

Pipe to Datadog, Grafana Loki, or CloudWatch Logs. The `trace_id` field maps 1:1 to W3C traceparent trace IDs.

### Prometheus metrics (`GET /metrics`)

```
pgag_gateway_requests_total{tenant,status}          request throughput by decision
pgag_gateway_request_duration_ms                    latency histogram
pgag_policy_decisions_total{tenant,decision,tool}   policy evaluation breakdown
pgag_tool_executions_total{tenant,tool}             successful tool executions
pgag_approvals_pending_total{tenant}                approval queue depth
pgag_ratelimiter_errors_total{tenant}               Redis failures (should be 0)
```

### Distributed tracing

The gateway reads the incoming W3C `traceparent` header and propagates `trace_id` through every log line and DB record. To enable full span export, add `@opentelemetry/sdk-node` with an OTLP exporter pointed at `OTEL_EXPORTER_OTLP_ENDPOINT` — no other code changes needed. See [`docs/operability.md`](docs/operability.md).

---

## Kubernetes / Helm

```bash
helm install pgag ./deploy/helm/policy-governed-ai-gateway \
  --set api.image.tag=0.1.0 \
  --set ingress.hosts[0].host=pgag.example.com \
  --namespace pgag --create-namespace
```

The chart includes HPA (2–10 replicas at 70% CPU), non-root pod security context, liveness/readiness probes wired to `/health` and `/ready`, ServiceMonitor for Prometheus Operator, TLS via cert-manager, and Bitnami PostgreSQL + Redis subcharts.

---

## Security model

| Concern | Implementation | Production upgrade |
|---|---|---|
| Authentication | Per-tenant API key (`X-API-Key`) | JWT/OIDC short-lived tokens |
| Tenant isolation | All queries filter by `tenant_id` | Per-tenant DB schemas |
| Policy default | Fail-closed: no match → deny | — |
| Input sanitization | Zod validation + `__proto__` key stripping | — |
| Audit integrity | Append-only `audit_logs` table | S3 + Object Lock + KMS signing |
| Rate limiting | Redis sliding-window; fail-open with log | Fail-closed for high-security |
| Secrets | `.env.example` only; `.env` in `.gitignore` | Vault / External Secrets Operator |
| RBAC | `users.role` stored (admin/operator/viewer) | Route-level enforcement |

See [`docs/security-model.md`](docs/security-model.md) for threat model and production hardening checklist.

---

## What I would add for production

**Near-term (would ship before first paying customer)**
- JWT/OIDC authentication with short-lived tokens
- `db.transaction()` wrapping multi-step approval writes
- Full RBAC enforcement on every route (not just stored roles)
- SSE endpoint for real-time approval notifications

**Medium-term (first enterprise contract)**
- MCP transport layer — replace mock executor with real MCP client (stdio/SSE)
- Policy-as-code — Git-backed rules, CI validation, GitOps operator
- Per-tenant DB schema isolation
- Audit log streaming to append-only sink (S3 + Object Lock)

**Longer-term**
- Full OpenTelemetry SDK with OTLP export
- Cost budgets — block requests when tenant monthly spend exceeds threshold
- Behavioral anomaly detection — alert on unusual agent call patterns

---

## Why this matters for enterprise AI gateways

The same three invariants that govern financial transaction processors, cloud IAM systems, and ML inference proxies apply here:

1. **Authorization happens at the gateway, not in the agent** — agents should not be trusted to enforce their own constraints
2. **Every action leaves an immutable record** — compliance requires being able to reconstruct exactly what an agent did and why it was permitted
3. **High-risk operations require a human in the loop** — autonomous systems need defined escalation paths before executing irreversible actions

This project is a working demonstration of all three, built with the same architectural patterns (tenant isolation, policy engine separation, append-only audit, cost accounting) that appear in production AI infrastructure.

---

## Repository structure

```
.
├── apps/
│   ├── api/                      Fastify gateway server
│   │   ├── src/db/               Drizzle ORM schema, migrations, seed
│   │   ├── src/middleware/       Auth, tenant context
│   │   ├── src/routes/           gateway · requests · audit · policies · approvals · health
│   │   ├── src/services/         tool-executor · cost-estimator · rate-limiter · telemetry
│   │   └── tests/                Vitest unit tests
│   └── web/                      React + Vite dashboard
│       └── src/
│           ├── api/              API client
│           ├── components/       RequestList · RequestDetail · DecisionBadge · DemoPanel
│           └── pages/            AuditPage · PoliciesPage
├── packages/
│   ├── policy-engine/            Pure policy evaluator — no I/O, fully unit-tested
│   └── shared/                   TypeScript types shared across packages
├── deploy/
│   ├── docker-compose.yml
│   ├── Dockerfile.api / .web
│   └── helm/                     Kubernetes Helm chart
└── docs/
    ├── architecture.md
    ├── security-model.md
    ├── operability.md
    └── demo-script.md
```

---

## Tech stack

| | |
|---|---|
| API | Fastify 4 · TypeScript · Node.js 20 |
| Database | PostgreSQL 16 · Drizzle ORM |
| Cache | Redis 7 |
| Policy engine | TypeScript · zero runtime dependencies |
| Frontend | React 18 · Vite · React Router |
| Tests | Vitest · 22 tests |
| Infrastructure | Docker Compose · Helm chart skeleton |
| Observability | JSON structured logs · Prometheus metrics · W3C trace context |
