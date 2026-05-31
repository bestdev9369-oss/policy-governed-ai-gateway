import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  real,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── Tenants ──────────────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  apiKey: text('api_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  slugIdx: uniqueIndex('tenants_slug_idx').on(t.slug),
  apiKeyIdx: uniqueIndex('tenants_api_key_idx').on(t.apiKey),
}));

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  role: text('role', { enum: ['admin', 'operator', 'viewer'] }).notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
  tenantIdx: index('users_tenant_idx').on(t.tenantId),
}));

// ─── Agents ───────────────────────────────────────────────────────────────────

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('agents_tenant_idx').on(t.tenantId),
}));

// ─── Tools ────────────────────────────────────────────────────────────────────

export const tools = pgTable('tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull(),
  category: text('category').notNull(),
  riskLevel: text('risk_level', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
}, (t) => ({
  nameIdx: uniqueIndex('tools_name_idx').on(t.name),
}));

// ─── Policy Rules ─────────────────────────────────────────────────────────────

export const policies = pgTable('policies', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  toolName: text('tool_name').notNull(),
  requiredScope: text('required_scope'),
  maxAmount: real('max_amount'),
  allowedAgentIds: jsonb('allowed_agent_ids').$type<string[]>(),
  blockedAgentIds: jsonb('blocked_agent_ids').$type<string[]>(),
  decision: text('decision', { enum: ['allow', 'deny', 'approval_required'] }).notNull(),
  reason: text('reason').notNull(),
  priority: integer('priority').notNull().default(10),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('policies_tenant_idx').on(t.tenantId),
  toolIdx: index('policies_tool_idx').on(t.toolName),
}));

// ─── Gateway Requests ─────────────────────────────────────────────────────────

export const gatewayRequests = pgTable('gateway_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  agentName: text('agent_name').notNull(),
  toolName: text('tool_name').notNull(),
  toolArgs: jsonb('tool_args').$type<Record<string, unknown>>().notNull(),
  traceId: text('trace_id').notNull(),
  status: text('status', {
    enum: ['pending', 'allowed', 'denied', 'approval_required', 'approved', 'rejected', 'error'],
  }).notNull().default('pending'),
  decision: text('decision', { enum: ['allow', 'deny', 'approval_required'] }),
  decisionReason: text('decision_reason'),
  matchedPolicyId: text('matched_policy_id'),
  toolResult: jsonb('tool_result').$type<Record<string, unknown>>(),
  latencyMs: integer('latency_ms'),
  costEstimate: real('cost_estimate'),
  tokenCount: integer('token_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => ({
  tenantIdx: index('gateway_requests_tenant_idx').on(t.tenantId),
  agentIdx: index('gateway_requests_agent_idx').on(t.agentId),
  statusIdx: index('gateway_requests_status_idx').on(t.status),
  createdIdx: index('gateway_requests_created_idx').on(t.createdAt),
  traceIdx: index('gateway_requests_trace_idx').on(t.traceId),
}));

// ─── Policy Decisions ─────────────────────────────────────────────────────────

export const policyDecisions = pgTable('policy_decisions', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => gatewayRequests.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  policyId: text('policy_id'),
  decision: text('decision', { enum: ['allow', 'deny', 'approval_required'] }).notNull(),
  reason: text('reason').notNull(),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  requestIdx: index('policy_decisions_request_idx').on(t.requestId),
}));

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  requestId: text('request_id'),
  agentId: text('agent_id'),
  userId: text('user_id'),
  action: text('action').notNull(),
  outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
  traceId: text('trace_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
  requestIdx: index('audit_logs_request_idx').on(t.requestId),
  createdIdx: index('audit_logs_created_idx').on(t.createdAt),
}));

// ─── Approvals ────────────────────────────────────────────────────────────────

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => gatewayRequests.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: text('resolved_by'),
  comment: text('comment'),
}, (t) => ({
  requestIdx: uniqueIndex('approvals_request_idx').on(t.requestId),
  statusIdx: index('approvals_status_idx').on(t.status),
}));

// ─── Cost Events ──────────────────────────────────────────────────────────────

export const costEvents = pgTable('cost_events', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => gatewayRequests.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  agentId: text('agent_id').notNull(),
  toolName: text('tool_name').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  model: text('model').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('cost_events_tenant_idx').on(t.tenantId),
  requestIdx: index('cost_events_request_idx').on(t.requestId),
}));
