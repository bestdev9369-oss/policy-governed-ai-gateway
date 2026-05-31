# Architecture

## Why a separate gateway?

Agents should not self-govern. An agent that decides for itself whether it is allowed to call a tool is not a controlled system — it is a trusted process with no external check. The gateway enforces authorization externally, so the control surface is independent of the agent's code and can be updated without redeploying agents.

This pattern mirrors how network infrastructure is designed: firewalls sit outside the application, not inside it.

---

## System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent / Application                          │
│            (any system invoking tools: LLM agent, script, CI job)   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               │  POST /v1/gateway/invoke
                               │  X-API-Key: {tenant-api-key}
                               │  traceparent: 00-{traceId}-{spanId}-01
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Gateway API  (Fastify + TypeScript)            │
│                                                                      │
│  1. authenticate      Validate API key → attach tenant context       │
│  2. rate-limit        Redis sliding-window; RFC 6585 headers on resp │
│  3. validate          Zod schema + strip __proto__ / constructor     │
│  4. resolve agent     Fetch agentId; enforce tenant isolation        │
│  5. write pending     INSERT gateway_requests (status=pending)       │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      Policy Engine                             │  │
│  │                                                               │  │
│  │  • Load all enabled policies for tenant, sort by priority ↓  │  │
│  │  • For each policy, gate on conditions:                       │  │
│  │      requiredScope   agent.scopes must include it             │  │
│  │      allowedAgentIds agent must be in list (if set)           │  │
│  │      blockedAgentIds agent must NOT be in list (if set)       │  │
│  │      maxAmount       toolArgs.amount must be ≤ threshold      │  │
│  │  • First policy where ALL conditions pass → fires             │  │
│  │  • No match → deny (fail-closed)                              │  │
│  └────────────────────┬──────────────────────────────────────────┘  │
│                       │                                              │
│         ┌─────────────┼──────────────┐                               │
│       allow         deny     approval_required                       │
│         │             │              │                               │
│   executeTool()    log & block   INSERT approvals                    │
│   (try/catch)          │         return 202                          │
│         │             │              │                               │
│         └─────────────┴──────────────┘                               │
│                       │                                              │
│  6. write audit log   INSERT audit_logs (append-only)                │
│  7. write cost event  INSERT cost_events (token count + USD)         │
│  8. emit metrics      Prometheus counters + histograms               │
│  9. propagate trace   trace_id in response + every log line          │
└──────────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
               PostgreSQL             Redis
              (all state)        (rate limiting)
                    │
                    ▼
             React Dashboard
             (reads via same API, same auth)
```

---

## Data model

```
tenants ─────┬──< users
             ├──< agents ──────< gateway_requests ──< policy_decisions
             │                                     ──< approvals
             │                                     ──< cost_events
             │                                     ──< audit_logs
             └──< policies
```

All tables are scoped by `tenant_id`. There is no query in the codebase that can return data across tenant boundaries.

---

## Policy evaluation in detail

Policies are the core control surface. The evaluator (`packages/policy-engine`) is a pure function with no I/O — it takes a context and returns a decision. This makes it straightforward to test and easy to reason about.

```
evaluate(context) → { decision, reason, matchedPolicyId }

context = {
  tenantId    string
  agentId     string
  agentScopes string[]
  toolName    string
  toolArgs    Record<string, unknown>
}
```

**Evaluation algorithm:**

```
1. Load policies WHERE tenant_id = ctx.tenantId AND tool_name = ctx.toolName
2. Sort by priority DESC (higher number = evaluated first)
3. For each policy:
   a. If requiredScope set AND agent lacks it → skip (record reason)
   b. If allowedAgentIds set AND agent not in list → skip
   c. If blockedAgentIds set AND agent in list → skip
   d. If maxAmount set AND toolArgs.amount > maxAmount → skip
   e. All conditions passed → return policy.decision + policy.reason
4. If no policy matched → return deny + first rejection reason from step 3
```

The "first rejection reason" at step 4 surfaces the highest-priority near-miss, giving operators the most useful diagnostic when debugging access configuration.

**Why fail-closed?** The alternative — failing open when no policy exists — would silently grant access to any tool as soon as a tenant's policy configuration has a gap. Fail-closed means a misconfigured policy set shows up as unexpected denials (visible, correctable) rather than unexpected permissions (invisible until exploited).

---

## Approval flow

```
Agent             Gateway                   Operator
  │                  │                          │
  │──invoke()───────►│                          │
  │                  │ eval → approval_required │
  │◄──202 approvalId─│                          │
  │                  │──notify(approvalId)──────►│  (via dashboard / webhook)
  │                  │                          │
  │                  │◄──POST /approve──────────│
  │                  │                          │
  │                  │ atomic UPDATE WHERE       │
  │                  │   status='pending'        │  (prevents double-execution)
  │                  │                          │
  │                  │ executeTool()             │
  │                  │ write cost_event          │
  │                  │ write audit_log           │
  │◄──result─────────│                          │
```

The approval status update uses `UPDATE WHERE status='pending'` as a compare-and-swap operation. If two operators approve simultaneously, only one write succeeds; the other receives a 409.

---

## Observability model

The gateway produces three complementary signals on every request:

| Signal | Format | Primary use |
|---|---|---|
| Structured log line | JSON to stdout | Search, alerting, dashboards (Loki, Datadog, CloudWatch) |
| Trace context | W3C `traceparent` header + `trace_id` in logs | Distributed tracing (Tempo, Jaeger, Datadog APM) |
| Metrics | Prometheus text at `/metrics` | Time-series, SLO tracking (Prometheus + Grafana) |

The `trace_id` field is a 128-bit hex string that maps directly to W3C traceparent and OpenTelemetry trace IDs. Adding `@opentelemetry/sdk-node` with an OTLP exporter enables full distributed tracing without changing any application code.

---

## What a production MCP transport layer would look like

The current `executeTool()` mock would be replaced by a real MCP client:

```
Gateway                    MCP Server (tool provider)
  │                              │
  │──spawn/connect()────────────►│  (stdio or SSE transport)
  │                              │
  │──tools/call {name, args}────►│
  │                              │
  │◄──result stream──────────────│
  │                              │
  │──close()────────────────────►│
```

The gateway would maintain a registry of tool servers (analogous to DNS for tools), resolve the correct server for each `toolName`, open an MCP session, proxy the call, and close the session. The policy evaluation and audit logging would remain unchanged — the transport is an implementation detail behind `executeTool()`.
