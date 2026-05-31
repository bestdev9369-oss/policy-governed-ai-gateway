# Demo Script — 2-Minute Walkthrough

A tight script for showing all three gateway scenarios live. Works as a Loom recording or in a screen-share interview.

---

## Setup (before you start recording)

```bash
cd policy-governed-ai-gateway
pnpm docker:up && pnpm db:migrate && pnpm db:seed
pnpm --filter @pgag/api dev &
pnpm --filter @pgag/web dev &
```

Open two windows side by side:
- **Left:** terminal for `curl` commands
- **Right:** browser at http://localhost:5173

Set the shell variable once:
```bash
export KEY="demo-tenant-key-acme" API="http://localhost:3000"
```

---

## Recording script (≈ 2 min)

### 0:00 — Context (15 s)

*"This is a policy-governed AI gateway — a control plane that sits between autonomous agents and the tools they want to call. Every request is authenticated, evaluated against a policy, and audit-logged. I'll show you the three key flows: allow, deny, and approval-required."*

---

### 0:15 — Scenario 1: Allowed (25 s)

*"SalesBot wants to look up a customer. It has the `crm:read` scope, and there's a policy that allows it."*

```bash
curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"agentId":"agent-sales-001","toolName":"lookup_customer","toolArgs":{"customer_id":"cust-42"}}' \
  | jq '{decision, status, costEstimate, latencyMs}'
```

*Point at the response:* `decision: "allow"`, tool result returned, cost tracked, latency logged.

---

### 0:40 — Scenario 2: Denied (20 s)

*"FinanceBot tries to run a wire transfer. The policy requires `finance:write` scope — FinanceBot only has `finance:read`. Blocked."*

```bash
curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"agentId":"agent-finance-001","toolName":"wire_transfer","toolArgs":{"amount":5000,"account":"ACC-999"}}' \
  | jq '{decision, status, reason}'
```

*Point at the response:* HTTP 403, `decision: "deny"`, specific reason surfaced. *"The tool was never called. The denial is in the audit log."*

---

### 1:00 — Scenario 3: Approval required (45 s)

*"MarketingBot wants to send an outbound email. Policy says human review required before delivery."*

```bash
RESP=$(curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{"agentId":"agent-marketing-001","toolName":"send_email","toolArgs":{"to":"vip@acme.com","subject":"Q2 Promo","body":"Hello"}}')

echo $RESP | jq '{decision, status, approvalId}'
APPROVAL_ID=$(echo $RESP | jq -r '.approvalId')
```

*"202 returned — the agent is blocked pending review."*

Switch to the browser. *"In the dashboard, the request shows as 'Approval Required'. Click it."*

Click the pending request → show the approval panel → click **Approve**.

*"Tool executes. Full audit chain written: request received → policy evaluated → approval requested → approval granted → tool executed → cost recorded."*

---

### 1:45 — Dashboard close (15 s)

Switch to the Policies tab. *"These are the policy rules that drove all three decisions — priority-ordered, tenant-scoped, configurable at runtime without redeploying."*

Switch to the Audit Logs tab. *"Every state transition is here, immutable, with the trace ID linking back to the original request."*

---

## Key talking points (if asked)

**"How is this different from just adding auth to a tool?"**
Auth on the tool only tells you who is calling. The gateway also evaluates what they're doing, under what conditions, and whether a human needs to be in the loop — before the tool executes, not after.

**"How does it handle multiple tenants?"**
Every database query filters by `tenant_id`. Policies, agents, requests, and audit logs are completely isolated. The policy engine loads only the calling tenant's rules.

**"What would you add before a production deployment?"**
JWT/OIDC tokens instead of API keys, `db.transaction()` for multi-step approval writes, full MCP transport layer replacing the mock executor, and per-tenant PostgreSQL schemas for hard data isolation.

**"What's the policy engine doing exactly?"**
It's a pure function — no I/O — that takes a context (tenantId, agentId, scopes, toolName, toolArgs) and walks a priority-sorted list of rules. Each rule is a set of conditions (scope gate, amount threshold, allowlist, blocklist). First rule where all conditions pass determines the outcome. No match → deny.
