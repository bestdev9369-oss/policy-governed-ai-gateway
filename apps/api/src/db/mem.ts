/**
 * In-memory PostgreSQL database for local development without Docker.
 *
 * Uses pg-mem (https://github.com/oguimbal/pg-mem) — a PostgreSQL-compatible
 * in-memory engine. The same Drizzle ORM queries run against it unchanged.
 *
 * Usage: DATABASE_URL=mem node --import tsx/esm src/dev-standalone.ts
 */

import { newDb } from 'pg-mem';
import pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pkg;

// DDL that matches schema.ts — written in plain SQL so pg-mem can parse it.
// pg-mem supports most PostgreSQL DDL but does not need JSONB to be declared
// differently; it treats JSON and JSONB identically.
const DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  api_key    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slug),
  UNIQUE(api_key)
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  description TEXT,
  scopes      JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tools (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  input_schema JSONB NOT NULL,
  category     TEXT NOT NULL,
  risk_level   TEXT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS policies (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,
  tool_name         TEXT NOT NULL,
  required_scope    TEXT,
  max_amount        REAL,
  allowed_agent_ids JSONB,
  blocked_agent_ids JSONB,
  decision          TEXT NOT NULL,
  reason            TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 10,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gateway_requests (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  agent_id         TEXT NOT NULL REFERENCES agents(id),
  agent_name       TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  tool_args        JSONB NOT NULL,
  trace_id         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  decision         TEXT,
  decision_reason  TEXT,
  matched_policy_id TEXT,
  tool_result      JSONB,
  latency_ms       INTEGER,
  cost_estimate    REAL,
  token_count      INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES gateway_requests(id),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  policy_id    TEXT,
  decision     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT,
  agent_id   TEXT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  detail     JSONB NOT NULL,
  trace_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES gateway_requests(id),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  status       TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT,
  comment      TEXT,
  UNIQUE(request_id)
);

CREATE TABLE IF NOT EXISTS cost_events (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES gateway_requests(id),
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  agent_id      TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  model         TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const SEED = `
INSERT INTO tenants (id, name, slug, api_key) VALUES
  ('tenant-acme-001', 'Acme Corp',        'acme', 'demo-tenant-key-acme'),
  ('tenant-beta-002', 'Beta Industries',  'beta', 'demo-tenant-key-beta')
ON CONFLICT DO NOTHING;

INSERT INTO agents (id, tenant_id, name, description, scopes) VALUES
  ('agent-sales-001',     'tenant-acme-001', 'SalesBot',     'Customer-facing sales automation', '["crm:read","crm:write"]'),
  ('agent-finance-001',   'tenant-acme-001', 'FinanceBot',   'Internal financial operations',    '["finance:read"]'),
  ('agent-marketing-001', 'tenant-acme-001', 'MarketingBot', 'Outbound communications agent',    '["crm:read","comms:send"]')
ON CONFLICT DO NOTHING;

INSERT INTO policies (id, tenant_id, name, tool_name, required_scope, max_amount, decision, reason, priority, enabled) VALUES
  ('policy-allow-crm-read',    'tenant-acme-001', 'Allow CRM read access',              'lookup_customer', 'crm:read',    NULL,  'allow',            'CRM read access permitted for agents with crm:read scope',                            10, TRUE),
  ('policy-deny-wire-transfer', 'tenant-acme-001', 'Require finance:write for transfers', 'wire_transfer',  'finance:write', NULL,'deny',             'Wire transfers require finance:write — FinanceBot only has finance:read',              20, TRUE),
  ('policy-deny-high-amount',  'tenant-acme-001', 'Block transfers above $10k',          'wire_transfer',   NULL,         10000, 'deny',             'Transfers above $10,000 are blocked by security policy',                              30, TRUE),
  ('policy-approval-email',    'tenant-acme-001', 'Require approval for outbound email', 'send_email',      'comms:send',  NULL, 'approval_required','All outbound email requires human review before delivery',                             10, TRUE),
  ('policy-beta-crm',          'tenant-beta-002', 'Beta: allow all CRM reads',           'lookup_customer', NULL,          NULL, 'allow',            'Beta tenant allows all agents to read CRM without scope requirement',                   5, TRUE)
ON CONFLICT DO NOTHING;
`;

export async function createMemDb() {
  const mem = newDb();

  // Expose a pg-compatible Pool
  const { Pool: MemPool } = mem.adapters.createPg();
  const pool = new MemPool() as unknown as InstanceType<typeof Pool>;

  // Create schema and seed
  await pool.query(DDL);
  await pool.query(SEED);

  const db = drizzle(pool, { schema });
  return { db, pool };
}
