/**
 * Seeds the database with demo data for all three gateway scenarios.
 *
 * Run with: pnpm db:seed
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import * as schema from './schema.js';

const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const db = drizzle(pool, { schema });

const TENANT_ACME_ID = 'tenant-acme-001';
const TENANT_BETA_ID = 'tenant-beta-002';

const AGENT_SALES_ID = 'agent-sales-001';
const AGENT_FINANCE_ID = 'agent-finance-001';
const AGENT_MARKETING_ID = 'agent-marketing-001';

async function seed() {
  console.log('🌱 Seeding database...');

  // ── Tenants ────────────────────────────────────────────────────────────────
  await db.insert(schema.tenants).values([
    {
      id: TENANT_ACME_ID,
      name: 'Acme Corp',
      slug: 'acme',
      apiKey: process.env['SEED_TENANT_API_KEY'] ?? 'demo-tenant-key-acme',
    },
    {
      id: TENANT_BETA_ID,
      name: 'Beta Industries',
      slug: 'beta',
      apiKey: 'demo-tenant-key-beta',
    },
  ]).onConflictDoNothing();

  // ── Users ──────────────────────────────────────────────────────────────────
  await db.insert(schema.users).values([
    { id: uuidv4(), tenantId: TENANT_ACME_ID, email: 'admin@acme.example', role: 'admin' },
    { id: uuidv4(), tenantId: TENANT_ACME_ID, email: 'operator@acme.example', role: 'operator' },
  ]).onConflictDoNothing();

  // ── Agents ─────────────────────────────────────────────────────────────────
  await db.insert(schema.agents).values([
    {
      id: AGENT_SALES_ID,
      tenantId: TENANT_ACME_ID,
      name: 'SalesBot',
      description: 'Customer-facing sales automation agent',
      scopes: ['crm:read', 'crm:write'],
    },
    {
      id: AGENT_FINANCE_ID,
      tenantId: TENANT_ACME_ID,
      name: 'FinanceBot',
      description: 'Internal financial operations agent',
      scopes: ['finance:read'],
    },
    {
      id: AGENT_MARKETING_ID,
      tenantId: TENANT_ACME_ID,
      name: 'MarketingBot',
      description: 'Outbound communications agent',
      scopes: ['crm:read', 'comms:send'],
    },
  ]).onConflictDoNothing();

  // ── Tools ──────────────────────────────────────────────────────────────────
  await db.insert(schema.tools).values([
    {
      id: 'tool-lookup-customer',
      name: 'lookup_customer',
      description: 'Look up customer information by ID or email',
      inputSchema: { type: 'object', properties: { customer_id: { type: 'string' } }, required: ['customer_id'] },
      category: 'crm',
      riskLevel: 'low',
    },
    {
      id: 'tool-wire-transfer',
      name: 'wire_transfer',
      description: 'Execute a wire transfer to a bank account',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' }, account: { type: 'string' } }, required: ['amount', 'account'] },
      category: 'finance',
      riskLevel: 'critical',
    },
    {
      id: 'tool-send-email',
      name: 'send_email',
      description: 'Send an email to one or more recipients',
      inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
      category: 'communications',
      riskLevel: 'medium',
    },
  ]).onConflictDoNothing();

  // ── Policies ───────────────────────────────────────────────────────────────
  await db.insert(schema.policies).values([
    // Scenario 1: allow
    {
      id: 'policy-allow-crm-read',
      tenantId: TENANT_ACME_ID,
      name: 'Allow CRM read access',
      toolName: 'lookup_customer',
      requiredScope: 'crm:read',
      decision: 'allow',
      reason: 'CRM read access is permitted for agents with crm:read scope',
      priority: 10,
      enabled: true,
    },
    // Scenario 2: deny — finance scope required for wire_transfer, FinanceBot lacks finance:write
    {
      id: 'policy-deny-wire-transfer',
      tenantId: TENANT_ACME_ID,
      name: 'Require finance:write for wire_transfer',
      toolName: 'wire_transfer',
      requiredScope: 'finance:write',
      maxAmount: 10000,
      decision: 'deny',
      reason: 'Wire transfers require finance:write scope — FinanceBot only has finance:read',
      priority: 20,
      enabled: true,
    },
    // Scenario 2b: deny high-amount transfers even with correct scope
    {
      id: 'policy-deny-high-amount',
      tenantId: TENANT_ACME_ID,
      name: 'Block transfers above $10,000',
      toolName: 'wire_transfer',
      requiredScope: undefined,
      maxAmount: 10000,
      decision: 'deny',
      reason: 'Transfers above $10,000 are blocked by security policy',
      priority: 30,
      enabled: true,
    },
    // Scenario 3: approval_required
    {
      id: 'policy-approval-send-email',
      tenantId: TENANT_ACME_ID,
      name: 'Require approval for outbound email',
      toolName: 'send_email',
      requiredScope: 'comms:send',
      decision: 'approval_required',
      reason: 'All outbound email requires human review before delivery',
      priority: 10,
      enabled: true,
    },
    // Beta tenant: different policy set — demonstrates tenant isolation
    {
      id: 'policy-beta-allow-all',
      tenantId: TENANT_BETA_ID,
      name: 'Beta: allow all CRM reads (less restrictive)',
      toolName: 'lookup_customer',
      decision: 'allow',
      reason: 'Beta tenant allows all agents to read CRM without scope requirement',
      priority: 5,
      enabled: true,
    },
  ]).onConflictDoNothing();

  console.log('✅ Seed complete');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
