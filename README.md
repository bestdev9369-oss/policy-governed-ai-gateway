# policy-governed-ai-gateway

**An enterprise-grade AI agent control plane with policy enforcement, human-in-the-loop approval, audit logging, and cost tracking.**

> Every tool call an autonomous agent makes passes through authentication, policy evaluation, and audit logging before being executed — or blocked. Built to demonstrate the backend engineering patterns required for production-grade AI infrastructure.

---

## Why This Exists

Autonomous AI agents operating in enterprise environments need more than just an LLM API key. They need:

- **Policy enforcement** — which agents can call which tools, under what conditions
- **Audit trails** — immutable logs of every action, who approved it, and why
- **Cost governance** — per-tenant token accounting and spend visibility
- **Human oversight** — configurable approval gates for high-risk operations
- **Tenant isolation** — complete separation of policy, data, and billing per customer

This project implements a gateway that enforces all of the above, independent of which model or tool provider is behind it. Designed around the same patterns as production MCP gateway infrastructure, but runnable as a complete local demo with no paid API keys.

---

## Architecture

```
Agent / Application
        │
        │  POST /v1/gateway/invoke
        │  X-API-Key: {tenant-api-key}
        ▼
┌───────────────────────────────────────────────────────────┐
│                   Gateway API  (Fastify + TypeScript)      │
│                                                           │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Auth /   │  │  Rate Limit  │  │  Input Validation  │  │
│  │  Tenant   │  │  (Redis)     │  │  (Zod)             │  │
│  └─────┬─────┘  └──────┬───────┘  └─────────┬──────────┘  │
│        └───────────────┴──────────────────┘               │
│                          │                                │
│                          ▼                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │               Policy Engine                         │  │
│  │  (priority-sorted rules, fail-closed by default)   │  │
│  │                                                    │  │
│  │  requiredScope · maxAmount · allowList · denyList  │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │                                   │
│         ┌─────────────┼─────────────┐                    │
│         ▼             ▼             ▼                    │
│      ALLOW          DENY     APPROVAL_REQUIRED           │
│         │             │             │                    │
│         ▼             │             ▼                    │
│  Tool Executor        │      Approval Queue              │
│  (mock / MCP)         │      (held until reviewed)       │
│         │             │             │                    │
│         └─────────────┴─────────────┘                    │
│                          │                                │
│                          ▼                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │   Audit Log · Cost Event · Metrics · Trace Context  │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                          │
                ┌─────────┴──────────┐
                │                    │
          PostgreSQL              Redis
          (persistent store)   (rate limiting)
                │
                ▼
        React Dashboard
        • Request list + decision badges
        • Approval action panel
        • Audit log viewer
        • Policy browser
        • Cost tracking
```

---

## Request Lifecycle

| Step | Component | What happens |
|------|-----------|-------------|
| 1 | API | Receive `POST /v1/gateway/invoke` |
| 2 | Auth middleware | Validate `X-API-Key`, attach tenant context |
| 3 | Rate limiter | Redis sliding-window check per tenant |
| 4 | Validator | Zod schema — reject malformed requests immediately |
| 5 | Agent lookup | Resolve agentId, enforce tenant isolation |
| 6 | DB write | Insert `gateway_requests` row with `status=pending` |
| 7 | Policy engine | Evaluate all enabled tenant policies, priority-ordered |
| 8a | allow | Execute mock tool, record cost event, return 200 |
| 8b | deny | Skip execution, write audit log, return 403 |
| 8c | approval_required | Create `approvals` row, return 202, pause execution |
| 9 | Audit | Write `audit_logs` row for every state transition |
| 10 | Metrics | Increment Prometheus counters and histograms |

---

## Policy Engine

Policies are JSON documents stored per tenant. The engine evaluates them in descending priority order. The first matching policy wins. **Default action is deny (fail-closed).**

### Example policies

```json
[
  {
    "name": "Allow CRM reads",
    "toolName": "lookup_customer",
    "requiredScope": "crm:read",
    "decision": "allow",
    "reason": "CRM read access permitted for agents with crm:read scope",
    "priority": 10
  },
  {
    "name": "Block high-value wire transfers",
    "toolName": "wire_transfer",
    "maxAmount": 10000,
    "decision": "deny",
    "reason": "Transfers above $10,000 require Finance VP approval",
    "priority": 30
  },
  {
    "name": "Require approval for outbound email",
    "toolName": "send_email",
    "requiredScope": "comms:send",
    "decision": "approval_required",
    "reason": "All outbound email requires human review before delivery",
    "priority": 10
  }
]
```

### Supported conditions

| Field | Type | Behavior |
|-------|------|----------|
| `toolName` | string | Exact tool name match |
| `requiredScope` | string | Agent's `scopes[]` must include this |
| `maxAmount` | number | `toolArgs.amount` must be ≤ this value |
| `allowedAgentIds` | string[] | Agent must be in this list |
| `blockedAgentIds` | string[] | Agent must NOT be in this list |
| `priority` | number | Higher wins; evaluated descending |
| `enabled` | boolean | Disabled policies are skipped entirely |

---

## Demo Scenarios

### Scenario 1: Allowed ✅

**SalesBot** calls `lookup_customer`. It has `crm:read` scope. Policy matches and allows execution. Gateway returns customer data and records $0.000012 cost.

### Scenario 2: Denied 🚫

**FinanceBot** calls `wire_transfer` with `amount: 5000`. It only has `finance:read` scope — the policy requires `finance:write`. Gateway returns HTTP 403. No tool is executed. Audit log records the denial reason.

### Scenario 3: Approval Required ⏳

**MarketingBot** calls `send_email`. Policy evaluates to `approval_required`. Gateway returns HTTP 202 with an `approvalId`. An operator reviews the request in the dashboard and clicks Approve — the gateway then executes the tool, records cost, and completes the audit chain.

---

## Local Setup

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- pnpm 9+

```bash
# 1. Clone
git clone https://github.com/your-username/policy-governed-ai-gateway
cd policy-governed-ai-gateway

# 2. Configure
cp .env.example .env        # defaults work for local dev

# 3. Install
pnpm install

# 4. Start infrastructure (Postgres + Redis)
pnpm docker:up

# 5. Run migrations
pnpm db:migrate

# 6. Seed demo data
pnpm db:seed

# 7. Start API (hot reload)
pnpm --filter @pgag/api dev

# 8. Start dashboard
pnpm --filter @pgag/web dev
```

Dashboard: http://localhost:5173 · API: http://localhost:3000

### One-command Docker Compose

```bash
pnpm docker:up
# API at :3000, Dashboard at :5173
```

---

## API Examples

```bash
export KEY="demo-tenant-key-acme"
export API="http://localhost:3000"

# Scenario 1 — Allowed
curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"agentId":"agent-sales-001","toolName":"lookup_customer","toolArgs":{"customer_id":"cust-42"}}' | jq

# Scenario 2 — Denied
curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"agentId":"agent-finance-001","toolName":"wire_transfer","toolArgs":{"amount":5000,"account":"ACC-999"}}' | jq

# Scenario 3 — Approval required → approve
RESP=$(curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"agentId":"agent-marketing-001","toolName":"send_email","toolArgs":{"to":"vip@acme.com","subject":"Promo","body":"Hello"}}')
APPROVAL_ID=$(echo $RESP | jq -r '.approvalId')
curl -s -X POST $API/v1/approvals/$APPROVAL_ID/approve \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"comment":"Looks good"}' | jq

# Management
curl -H "X-API-Key: $KEY" $API/v1/requests | jq '.data[0]'
curl -H "X-API-Key: $KEY" $API/v1/audit-logs | jq '.data[].action'
curl -H "X-API-Key: $KEY" $API/v1/policies | jq '.data[].name'
curl $API/health
curl $API/metrics
```

---

## Screenshots

> _Capture these after running the demo scenarios._

| File | What to show |
|---|---|
| `screenshots/01-request-list.png` | Request list with all three decision badge colors |
| `screenshots/02-denied-detail.png` | Request detail for the denied wire_transfer |
| `screenshots/03-approval-panel.png` | Approval action card for the pending send_email |
| `screenshots/04-audit-trail.png` | Full audit log chain for an approved request |
| `screenshots/05-policies.png` | Policy browser with priorities and conditions |
| `screenshots/06-metrics.png` | Raw `/metrics` Prometheus output |

---

## Testing

```bash
# All tests
pnpm test

# Policy engine only (no DB dependency)
pnpm --filter @pgag/policy-engine test

# API tests
pnpm --filter @pgag/api test
```

Test coverage:
- Policy allow / deny / approval_required decisions
- Tenant isolation (cross-tenant policy leakage)
- Amount threshold enforcement
- Priority ordering (higher-priority policy wins)
- Fail-closed default (no matching policy → deny)
- Cost estimator positive values for known and unknown tools
- Invalid request rejection

---

## Observability

### Structured logs (JSON)

```json
{
  "time": "2024-05-30T10:23:45.123Z",
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

### Prometheus metrics (`GET /metrics`)

```
pgag_gateway_requests_total{tenant="...",status="allowed"} 142
pgag_gateway_request_duration_ms_count{tenant="..."} 167
pgag_policy_decisions_total{decision="deny",tool="wire_transfer"} 18
pgag_cost_usd_total{tenant="..."} 0.001847
```

### Distributed tracing

Gateway propagates W3C `traceparent` headers. Wire in `@opentelemetry/sdk-node` + OTLP exporter to send spans to Jaeger, Grafana Tempo, or Datadog APM. The `trace_id` in every log line maps 1:1 to OTLP trace IDs.

See [`docs/operability.md`](docs/operability.md) for Prometheus, Loki, and OTel integration examples.

---

## Kubernetes / Helm

```bash
helm install pgag ./deploy/helm/policy-governed-ai-gateway \
  --set api.image.tag=0.1.0 \
  --set ingress.hosts[0].host=pgag.example.com \
  --namespace pgag --create-namespace
```

Chart includes: HPA (2–10 replicas), non-root security context, liveness/readiness probes, ServiceMonitor for Prometheus Operator, Ingress with TLS via cert-manager, Bitnami PostgreSQL + Redis subcharts.

See [`deploy/helm/policy-governed-ai-gateway/values.yaml`](deploy/helm/policy-governed-ai-gateway/values.yaml).

---

## Security Model

| Concern | Current implementation |
|---|---|
| Authentication | Per-tenant API key (`X-API-Key` header) |
| Tenant isolation | All queries filter by `tenant_id` |
| RBAC | `users.role` — admin / operator / viewer |
| Fail-closed policy | No matching policy → deny |
| Audit immutability | Append-only `audit_logs` table |
| Rate limiting | Redis sliding-window per tenant |
| Input validation | Zod schema on all endpoints |
| No secrets in repo | `.env.example` only; `.env` in `.gitignore` |

See [`docs/security-model.md`](docs/security-model.md) for full threat model and production hardening checklist.

---

## What I Would Add for Production

1. **JWT / OIDC authentication** — Short-lived tokens via Auth0 or Keycloak, API keys for M2M only
2. **Full RBAC enforcement** — Route-level permission checks against `user.role`
3. **MCP transport** — Replace the mock executor with a real MCP client (stdio / SSE sessions to tool servers)
4. **Streaming approvals** — SSE for real-time notifications without polling
5. **Policy-as-code** — Git-backed policies, CI validation, GitOps operator
6. **Per-tenant DB schemas** — Strong data isolation guarantees
7. **Immutable audit streaming** — S3 + Object Lock with KMS batch signing
8. **Full OpenTelemetry SDK** — Replace lightweight trace context with OTLP export
9. **Cost budget enforcement** — Block requests when monthly spend exceeds threshold
10. **Anomaly detection** — Alert on unusual agent behavior patterns

---

## Why This Is Relevant to Enterprise AI Gateways

Autonomous AI agents in enterprise deployments need access to real business tools — CRM, ERP, finance systems — but organizations cannot grant unconstrained access. The missing layer is a **control plane** that:

1. Authenticates and identifies every agent by tenant and scope
2. Enforces least-privilege access via configurable policies
3. Gates high-risk operations behind human approval
4. Provides an immutable audit trail for compliance and forensics
5. Tracks per-tenant token usage and cost for billing

This is the core problem MCP gateway products are solving today. The patterns here — tenant isolation, fail-closed policy evaluation, human-in-the-loop approval queues, append-only audit logs — are the same patterns that appear in enterprise IAM, financial transaction processors, and ML inference proxies. They transfer directly to production AI infrastructure.

---

## Repository Structure

```
policy-governed-ai-gateway/
├── apps/
│   ├── api/                    # Fastify API server
│   │   ├── src/db/             # Drizzle ORM schema + migrations + seed
│   │   ├── src/middleware/     # Auth, tenant context
│   │   ├── src/routes/         # gateway, requests, audit, policies, approvals, health
│   │   ├── src/services/       # tool-executor, cost-estimator, rate-limiter, telemetry
│   │   └── tests/              # Vitest unit tests
│   └── web/                    # React + Vite dashboard
├── packages/
│   ├── policy-engine/          # Pure policy evaluator (no I/O, fully testable)
│   └── shared/                 # TypeScript types shared across packages
├── deploy/
│   ├── docker-compose.yml
│   ├── Dockerfile.api / Dockerfile.web
│   └── helm/policy-governed-ai-gateway/   # Helm chart skeleton
└── docs/
    ├── architecture.md
    ├── security-model.md
    ├── operability.md
    └── demo-script.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | Fastify 4 + TypeScript |
| Database | PostgreSQL 16 + Drizzle ORM |
| Cache / rate limiting | Redis 7 |
| Policy engine | Custom TypeScript, zero runtime dependencies |
| Frontend | React 18 + Vite + React Router |
| Testing | Vitest |
| Containerization | Docker + Docker Compose |
| Kubernetes | Helm chart skeleton |
| Observability | Structured JSON logs · Prometheus metrics · W3C trace context |
