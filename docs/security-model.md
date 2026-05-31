# Security Model

## Threat Model

The gateway defends against three primary threat categories in AI agent deployments:

1. **Overprivileged agents** — Agents that attempt to call tools outside their intended scope.
2. **Prompt injection** — Adversarial content in user data that causes agents to invoke unintended tools.
3. **Runaway automation** — Agents executing high-value, irreversible actions without human oversight.

## Authentication

### API Key Authentication

Tenants authenticate via the `X-API-Key` header. Each tenant has exactly one API key stored as a plain string in the database (production should hash with bcrypt or use a token service like HashiCorp Vault).

```
Production hardening:
  1. Hash API keys at rest (bcrypt, Argon2)
  2. Issue short-lived tokens via OIDC (OAuth 2.0 client credentials flow)
  3. Store tokens in Vault or AWS Secrets Manager
  4. Rotate keys without downtime via dual-key grace period
```

### Agent Identity

Agents are identified by `agentId` (opaque string), which is validated against the `agents` table. Tenant isolation is enforced at the database query level — an agent from tenant A cannot be used by tenant B even if the ID is known.

## Tenant Isolation

All database queries filter by `tenant_id`. The `PolicyEvaluator` only loads policies for the requesting tenant. This is enforced at the service layer, not just the API layer.

**Isolation invariants:**
- A tenant's requests, policies, agents, and audit logs are never mixed with another tenant's.
- The API key grants access to exactly one tenant's data.
- In a multi-tenant deployment, each tenant should use a dedicated database schema (future improvement).

## RBAC (Role-Based Access Control)

```
Role        | Read Requests | Approve | Manage Policies | Admin
------------|---------------|---------|-----------------|------
viewer      |     ✓         |   ✗     |       ✗         |  ✗
operator    |     ✓         |   ✓     |       ✗         |  ✗
admin       |     ✓         |   ✓     |       ✓         |  ✗
super-admin |     ✓         |   ✓     |       ✓         |  ✓
```

Current implementation: roles are stored in the `users` table. Full RBAC enforcement on API routes is a near-term improvement (see below).

## Policy as a Security Boundary

The policy engine is the primary control surface. Policies are:
- **Tenant-scoped** — policies never cross tenant boundaries
- **Fail-closed** — no matching policy → deny (not allow)
- **Priority-ordered** — explicit deny policies can override lower-priority allow policies
- **Immutable in audit** — policy decisions are written to `policy_decisions` table and cannot be modified

## Audit Log Integrity

Audit logs are append-only. The schema has no `UPDATE` or `DELETE` on `audit_logs`. In production:
- Write audit logs to a separate append-only Postgres table with row-level security.
- Stream audit logs to an immutable sink (S3 + Object Lock, AWS CloudTrail, Splunk).
- Sign audit log batches with a KMS key for tamper detection.

## Rate Limiting

Redis sliding-window rate limiting prevents:
- Token exhaustion attacks from a single tenant
- Scraping cost data from the `/metrics` endpoint
- Brute-force API key enumeration

Rate limits are configurable per deployment via environment variables.

## Secret Management

No secrets are committed to the repository. `.env.example` contains placeholder values only.

Production secret management:
```
Kubernetes: External Secrets Operator → AWS Secrets Manager / Vault
Docker Compose: .env file (never committed, generated at deploy time)
CI/CD: GitHub Actions encrypted secrets → injected at runtime
```

## Input Validation

All API inputs are validated with Zod schemas before reaching any business logic. Invalid requests are rejected with structured error responses that do not leak internal state.

## Network Security

Production deployment recommendations:
- TLS termination at ingress (cert-manager + Let's Encrypt)
- API behind private VPC, only ingress exposed publicly
- Redis and PostgreSQL on private subnets with no public access
- Network policies in Kubernetes limiting pod-to-pod communication

## What We Would Add for Production

1. **JWT authentication** with OIDC provider (Auth0, Keycloak, Okta)
2. **API key hashing** at rest (bcrypt or Argon2)
3. **Full RBAC enforcement** on every route
4. **Audit log streaming** to immutable sink
5. **mTLS** between services
6. **Secrets rotation** with zero-downtime key handover
7. **WAF integration** at ingress for prompt injection detection
8. **Anomaly detection** on policy decision patterns
