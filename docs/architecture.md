# Architecture

## Overview

Policy-Governed AI Gateway is a control-plane service that sits between autonomous agents and their tool execution environment. Every tool call passes through authentication, policy evaluation, optional human approval, and audit logging before being executed — or blocked.

## System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent / Application                         │
│              (any system calling tools via MCP or HTTP)             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  POST /v1/gateway/invoke
                               │  X-API-Key: {tenant-key}
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Gateway API (Fastify)                       │
│                                                                      │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────┐ │
│  │  Auth Layer │  │  Rate Limiter    │  │  Request Validator     │ │
│  │  (API Key / │  │  (Redis sliding  │  │  (Zod schema)          │ │
│  │   JWT)      │  │   window)        │  │                        │ │
│  └──────┬──────┘  └────────┬─────────┘  └──────────┬─────────────┘ │
│         └──────────────────┴───────────────────────┘               │
│                               │                                      │
│                               ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Policy Engine                               │  │
│  │                                                               │  │
│  │  1. Load tenant policies (priority-sorted)                    │  │
│  │  2. Evaluate conditions:                                      │  │
│  │     • required_scope     — agent has this scope?              │  │
│  │     • allowed_agent_ids  — agent in allowlist?                │  │
│  │     • blocked_agent_ids  — agent in blocklist?                │  │
│  │     • max_amount         — toolArgs.amount ≤ threshold?       │  │
│  │  3. Return first matching policy decision:                    │  │
│  │     allow │ deny │ approval_required                          │  │
│  │  4. Default: deny (fail-closed)                               │  │
│  └─────────────────────────────┬─────────────────────────────────┘  │
│                                │                                     │
│            ┌───────────────────┼───────────────────┐                │
│            │                   │                   │                │
│            ▼                   ▼                   ▼                │
│       ┌─────────┐       ┌────────────┐    ┌──────────────┐         │
│       │  ALLOW  │       │   DENY     │    │  APPROVAL    │         │
│       │         │       │            │    │  REQUIRED    │         │
│       └────┬────┘       └─────┬──────┘    └──────┬───────┘         │
│            │                  │                   │                 │
│            ▼                  │                   ▼                 │
│  ┌─────────────────┐          │          ┌─────────────────┐        │
│  │  Tool Executor  │          │          │  Approval Queue  │        │
│  │  (Mock / MCP)   │          │          │  (Postgres row)  │        │
│  └────────┬────────┘          │          └────────┬────────┘        │
│           │                   │                   │                 │
│           └───────────────────┼───────────────────┘                │
│                               │                                     │
│                               ▼                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                   Audit + Observability                        │  │
│  │                                                               │  │
│  │  • audit_logs row  — immutable trail of every action          │  │
│  │  • cost_events row — token count + USD estimate               │  │
│  │  • structured JSON log — trace_id, latency_ms, decision       │  │
│  │  • /metrics endpoint — Prometheus-compatible counters          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │   PostgreSQL (persistent store) │
              │   Redis (rate limiting)         │
              └────────────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │   Dashboard (React / Vite)      │
              │   • Request list + filters      │
              │   • Decision badges             │
              │   • Approval action buttons     │
              │   • Audit log viewer            │
              │   • Policy browser              │
              └────────────────────────────────┘
```

## Request Lifecycle

1. **Receive** — Fastify accepts the `POST /v1/gateway/invoke` request.
2. **Authenticate** — API key is validated against the `tenants` table. Tenant context is attached to the request.
3. **Rate-limit** — A Redis sliding-window check prevents abuse per tenant per endpoint.
4. **Validate** — Zod schema ensures required fields are present and well-formed.
5. **Resolve agent** — Agent record is fetched; tenant isolation is enforced (agent must belong to the requesting tenant).
6. **Write pending record** — `gateway_requests` row is written with `status=pending` so any crash leaves a trace.
7. **Evaluate policy** — `PolicyEvaluator.evaluate()` walks the tenant's policy rules, sorted by priority.
8. **Branch on decision**:
   - `allow` → execute tool, write cost event, update status to `allowed`
   - `deny` → skip execution, update status to `denied`, return 403
   - `approval_required` → create `approvals` row, return 202, wait for human action
9. **Audit log** — Every state transition writes an `audit_logs` row.
10. **Metrics** — Counters and histograms updated for Prometheus scraping.
11. **Respond** — Structured JSON response with decision, reason, trace_id, and cost estimate.

## Data Model

```
tenants ──< users
        ──< agents ──< gateway_requests ──< policy_decisions
                                        ──< approvals
                                        ──< cost_events
                                        ──< audit_logs
        ──< policies
```

## Policy Evaluation Detail

Policies are evaluated in descending priority order. The first policy whose conditions all pass determines the outcome. Conditions are ANDed (all must pass). If no policy matches, the gateway fails closed (`deny`).

### Condition evaluation order

1. `enabled` check (disabled policies are skipped entirely)
2. `toolName` match
3. `requiredScope` — agent's scopes array must include the required scope
4. `allowedAgentIds` — if set, agent must be in the list
5. `blockedAgentIds` — if set, agent must NOT be in the list
6. `maxAmount` — extracts amount from `toolArgs.amount|value|transfer_amount|payment_amount`

## Observability Integration

The gateway produces three observability artifacts on every request:

| Artifact | Format | Integration point |
|---|---|---|
| Structured log | JSON lines to stdout | Datadog, Grafana Loki, CloudWatch Logs |
| Trace context | W3C traceparent header | Jaeger, Grafana Tempo, AWS X-Ray |
| Metrics | Prometheus text format (`/metrics`) | Prometheus + Grafana, Datadog Agent |

To connect to an OpenTelemetry collector, add `@opentelemetry/sdk-node` and configure the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable. The `trace_id` field already follows the W3C 128-bit format and maps directly to OTLP trace IDs.
