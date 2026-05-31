# Demo Script — 2-Minute Walkthrough

This script lets you demo all three gateway scenarios to a technical audience in under 2 minutes.

## Prerequisites

```bash
git clone https://github.com/your-username/policy-governed-ai-gateway
cd policy-governed-ai-gateway
cp .env.example .env
pnpm docker:up
# Wait ~15s for Postgres to initialize
pnpm db:migrate && pnpm db:seed
```

## Terminal Setup

Open two terminal panes: one for watching logs, one for API calls.

**Pane 1 — Tail structured logs:**
```bash
pnpm docker:logs api 2>&1 | grep -v "^$"
```

**Pane 2 — API calls** (set the key once):
```bash
export KEY="demo-tenant-key-acme"
export API="http://localhost:3000"
```

---

## Scenario 1: Allowed Request ✅ (~20 seconds)

*"SalesBot wants to look up a customer. It has the `crm:read` scope. The policy allows this."*

```bash
curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{
    "agentId": "agent-sales-001",
    "toolName": "lookup_customer",
    "toolArgs": { "customer_id": "cust-42" }
  }' | jq '{decision, status, toolResult, costEstimate, latencyMs}'
```

**Expected response:**
```json
{
  "decision": "allow",
  "status": "allowed",
  "toolResult": {
    "customer_id": "cust-42",
    "name": "Elara Voss",
    "plan": "enterprise",
    "mrr_usd": 4800
  },
  "costEstimate": 0.000012,
  "latencyMs": 94
}
```

*Point out: decision=allow, tool executed, cost tracked, audit written.*

---

## Scenario 2: Denied Request 🚫 (~20 seconds)

*"FinanceBot tries to execute a wire transfer. It only has `finance:read` — the policy requires `finance:write`. Blocked."*

```bash
curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{
    "agentId": "agent-finance-001",
    "toolName": "wire_transfer",
    "toolArgs": { "amount": 5000, "account": "ACC-999" }
  }' | jq '{decision, status, reason}'
```

**Expected response (HTTP 403):**
```json
{
  "decision": "deny",
  "status": "denied",
  "reason": "Wire transfers require finance:write scope — FinanceBot only has finance:read"
}
```

*Point out: HTTP 403, no tool executed, audit log shows the denial reason.*

---

## Scenario 3: Approval Required ⏳ (~60 seconds)

*"MarketingBot wants to send an email. Policy requires human review before delivery."*

**Step 3a — Invoke:**
```bash
RESP=$(curl -s -X POST $API/v1/gateway/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{
    "agentId": "agent-marketing-001",
    "toolName": "send_email",
    "toolArgs": {
      "to": "vip@acme.com",
      "subject": "Q2 Promo",
      "body": "Hello!"
    }
  }')

echo $RESP | jq '{decision, status, approvalId}'
APPROVAL_ID=$(echo $RESP | jq -r '.approvalId')
```

**Expected (HTTP 202):**
```json
{
  "decision": "approval_required",
  "status": "approval_required",
  "approvalId": "uuid-here"
}
```

*"The request is held. The agent gets a 202. Now show the dashboard — click the pending request, hit Approve."*

**Step 3b — Approve via API** (or use the dashboard button):
```bash
curl -s -X POST $API/v1/approvals/$APPROVAL_ID/approve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{"comment": "Approved after review"}' | jq '{status, toolResult}'
```

**Expected:**
```json
{
  "status": "approved",
  "toolResult": {
    "message_id": "msg-abc123",
    "status": "queued",
    "recipient": "vip@acme.com"
  }
}
```

---

## Dashboard Walkthrough (~20 seconds)

Open http://localhost:5173

1. **Request list** — see all three requests with decision badges
2. **Click the approval_required row** — show the approval action panel
3. **Audit tab** — show the full immutable audit trail
4. **Policies tab** — show the JSON policy rules evaluated

---

## Quick API Reference

```bash
# List all requests
curl -H "X-API-Key: $KEY" $API/v1/requests | jq '.data[0]'

# Get request detail with audit trail
curl -H "X-API-Key: $KEY" $API/v1/requests/{id} | jq

# View audit log
curl -H "X-API-Key: $KEY" $API/v1/audit-logs | jq '.data[].action'

# View policies
curl -H "X-API-Key: $KEY" $API/v1/policies | jq '.data[].name'

# Prometheus metrics
curl $API/metrics

# Health check
curl $API/health
```
