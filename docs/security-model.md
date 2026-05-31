# Security Model

## Threat model

Three categories of threat are relevant to an AI agent gateway:

**1. Overprivileged agents**
An agent is instructed (or prompt-injected) to call a tool outside its intended scope. Mitigation: policy engine with explicit scope requirements; fail-closed default.

**2. Prompt injection → tool misuse**
Adversarial content in retrieved data (emails, documents, CRM records) causes an agent to invoke a high-risk tool with attacker-controlled arguments. Mitigation: `approval_required` policy for high-risk tools; amount thresholds; human review before execution.

**3. Tenant data leakage**
One tenant's data or policy configuration is accessible to another tenant. Mitigation: all database queries filter by `tenant_id`; validated at the service layer, not just the API layer.

---

## Authentication

**Current: API key**

Tenants authenticate via the `X-API-Key` header. The key is stored in the `tenants` table and looked up on every request. If the key is not found, the request is rejected before any business logic runs.

**Production upgrade path**

1. Issue short-lived JWT tokens from an OIDC provider (Auth0, Keycloak, Okta)
2. Verify token signature at the gateway using the provider's JWKS endpoint
3. Retain API keys only for M2M service accounts; hash at rest with Argon2
4. Implement key rotation with a dual-key grace period for zero-downtime rotation

---

## Tenant isolation

Every table in the schema carries a `tenant_id` foreign key. No query in the codebase omits this filter. The `authenticate` middleware attaches `request.tenantId`; every route handler uses it in every database condition.

The policy engine is instantiated per-request and loads only the calling tenant's policies. It is impossible to accidentally evaluate a different tenant's rules.

**Production upgrade:** per-tenant PostgreSQL schemas (separate namespaces) provide isolation at the database layer as well, preventing a SQL injection or ORM bug from crossing tenant boundaries.

---

## RBAC

Roles are stored in the `users` table:

| Role | Read requests | Approve | Manage policies | Read audit logs |
|---|---|---|---|---|
| `viewer` | ✓ | | | ✓ |
| `operator` | ✓ | ✓ | | ✓ |
| `admin` | ✓ | ✓ | ✓ | ✓ |

Current implementation: roles are stored and exposed in the data model. Full route-level enforcement (checking `request.user.role` before performing privileged operations) is the near-term production addition.

---

## Policy engine as a security boundary

The policy engine enforces fail-closed by design:

- No matching policy → **deny**
- A disabled policy → skipped entirely (not a default allow)
- A policy missing a condition (e.g. no `requiredScope`) → condition is not checked (permissive on that axis only)

Policy decisions are written to `policy_decisions` as an immutable record before any tool execution occurs. This means the audit trail captures what the policy engine decided, not just what the tool did.

**Priority-ordered evaluation** means a high-priority deny policy can override lower-priority allow policies. This allows operators to add emergency blocks that take effect immediately without removing existing allow rules.

---

## Audit log integrity

`audit_logs` is append-only in the application layer. The schema defines no update or delete paths for this table.

**Production hardening:**
1. Add a PostgreSQL row-level security policy allowing only INSERT, no UPDATE/DELETE
2. Stream audit logs to S3 with Object Lock (WORM) in a separate account
3. Batch-sign log records with a KMS key for tamper detection
4. Retain for the compliance period required by your regulatory framework (SOC 2: 1 year minimum)

---

## Rate limiting

The gateway uses a Redis sliding-window rate limiter (not a fixed bucket). This is fairer to API clients and harder to game than fixed-window counters.

If Redis is unavailable, the limiter **fails open** (allows the request) to avoid Redis becoming a required dependency for gateway availability. This is logged as a warning and increments a `pgag_ratelimiter_errors_total` metric so on-call is notified.

**Trade-off:** in high-security deployments (financial services, healthcare), change the catch branch in `rate-limiter.ts` to fail-closed. For typical SaaS deployments, a brief window of unlimited traffic during a Redis outage is preferable to a complete gateway outage.

---

## Input validation and sanitization

All API inputs are validated with Zod schemas. Requests that fail validation are rejected before reaching any database or policy evaluation logic.

`toolArgs` additionally strips prototype-polluting keys (`__proto__`, `constructor`, `prototype`) before the object is stored or passed to the tool executor. This prevents a class of injection attacks where an attacker embeds control characters in tool arguments.

---

## Secrets management

No secrets are committed to the repository. `.env.example` contains placeholder values only. The actual `.env` file is in `.gitignore`.

| Secret | Local | Production |
|---|---|---|
| `DATABASE_URL` | Docker Compose env | External Secrets Operator → Vault or AWS Secrets Manager |
| `REDIS_URL` | Docker Compose env | Same |
| `JWT_SECRET` | `.env` file | Same |
| Tenant API keys | Seeded via `db:seed` script | Generated at tenant onboarding, hashed at rest |

---

## What was deliberately not built (and why)

**mTLS between services** — relevant once the gateway is split into microservices; out of scope for this single-service demo.

**WAF / prompt injection detection** — a separate concern better handled at the API gateway layer (Kong, AWS API Gateway) upstream of this service.

**Key escrow / multi-party authorization** — relevant for the approval flow in high-compliance environments; the current approval model (single approver) is the foundation.
