/**
 * Unit tests for the policy engine via the gateway integration.
 * These run without a database — the DB is mocked in setup.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyEvaluator } from '@pgag/policy-engine';
import type { PolicyStore } from '@pgag/policy-engine';
import type { PolicyRule } from '@pgag/shared';

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'pol-test',
    tenantId: 'tenant-1',
    name: 'Test Policy',
    toolName: 'lookup_customer',
    requiredScope: 'crm:read',
    decision: 'allow',
    reason: 'CRM read allowed',
    priority: 10,
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function storeWith(rules: PolicyRule[]): PolicyStore {
  return {
    getPoliciesForTenant: async (tid) => rules.filter((r) => r.tenantId === tid),
  };
}

describe('Policy Engine — gateway scenarios', () => {
  describe('Scenario 1: Allowed request (lookup_customer)', () => {
    it('allows when scope matches and policy is allow', async () => {
      const engine = new PolicyEvaluator(storeWith([makeRule()]));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'agent-a',
        agentScopes: ['crm:read'],
        toolName: 'lookup_customer',
        toolArgs: {},
        requestId: 'req-1',
      });
      expect(result.decision).toBe('allow');
    });

    it('tracks which policy matched', async () => {
      const engine = new PolicyEvaluator(storeWith([makeRule({ id: 'pol-crm-001' })]));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'agent-a',
        agentScopes: ['crm:read'],
        toolName: 'lookup_customer',
        toolArgs: {},
        requestId: 'req-1',
      });
      expect(result.matchedPolicyId).toBe('pol-crm-001');
    });
  });

  describe('Scenario 2: Denied request (wire_transfer)', () => {
    it('denies wire_transfer when agent lacks finance:write scope', async () => {
      const rule = makeRule({
        toolName: 'wire_transfer',
        requiredScope: 'finance:write',
        decision: 'deny',
        reason: 'Wire transfer blocked: insufficient scope',
      });
      const engine = new PolicyEvaluator(storeWith([rule]));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'finance-bot',
        agentScopes: ['finance:read'],  // has read, not write
        toolName: 'wire_transfer',
        toolArgs: { amount: 5000 },
        requestId: 'req-2',
      });
      expect(result.decision).toBe('deny');
    });

    it('denies wire_transfer when amount exceeds threshold', async () => {
      const rule = makeRule({
        toolName: 'wire_transfer',
        requiredScope: undefined,
        maxAmount: 1000,
        decision: 'allow',  // would allow, but amount triggers deny
      });
      const engine = new PolicyEvaluator(storeWith([rule]));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'finance-bot',
        agentScopes: ['finance:write'],
        toolName: 'wire_transfer',
        toolArgs: { amount: 50000 },
        requestId: 'req-2b',
      });
      expect(result.decision).toBe('deny');
    });
  });

  describe('Scenario 3: Approval-required request (send_email)', () => {
    it('returns approval_required for send_email with correct scope', async () => {
      const rule = makeRule({
        toolName: 'send_email',
        requiredScope: 'comms:send',
        decision: 'approval_required',
        reason: 'Email sends require human review',
      });
      const engine = new PolicyEvaluator(storeWith([rule]));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'marketing-bot',
        agentScopes: ['crm:read', 'comms:send'],
        toolName: 'send_email',
        toolArgs: { to: 'user@example.com', subject: 'Hello', body: 'Test' },
        requestId: 'req-3',
      });
      expect(result.decision).toBe('approval_required');
    });
  });

  describe('Audit log creation', () => {
    it('evaluatedPolicies count is correct', async () => {
      const rules = [
        makeRule({ id: 'pol-a', toolName: 'lookup_customer', priority: 10 }),
        makeRule({ id: 'pol-b', toolName: 'lookup_customer', priority: 5 }),
      ];
      const engine = new PolicyEvaluator(storeWith(rules));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'agent-a',
        agentScopes: ['crm:read'],
        toolName: 'lookup_customer',
        toolArgs: {},
        requestId: 'req-audit',
      });
      expect(result.evaluatedPolicies).toBe(2);
    });
  });

  describe('Cost event created (estimateCost)', () => {
    it('returns positive cost for known tools', async () => {
      const { estimateCost } = await import('../src/services/cost-estimator.js');
      const result = estimateCost('lookup_customer');
      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
    });

    it('returns positive cost for unknown tools using default profile', async () => {
      const { estimateCost } = await import('../src/services/cost-estimator.js');
      const result = estimateCost('some_unknown_tool');
      expect(result.costUsd).toBeGreaterThan(0);
    });
  });

  describe('Tenant isolation', () => {
    it('does not apply policies across tenants', async () => {
      const rule = makeRule({ tenantId: 'tenant-evil', decision: 'allow' });
      const engine = new PolicyEvaluator(storeWith([rule]));
      // tenant-1 has no policies → should fail-closed
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'agent-a',
        agentScopes: ['crm:read'],
        toolName: 'lookup_customer',
        toolArgs: {},
        requestId: 'req-isolation',
      });
      expect(result.decision).toBe('deny');
    });
  });

  describe('Invalid request validation', () => {
    it('fails closed when no matching policy exists', async () => {
      const engine = new PolicyEvaluator(storeWith([]));
      const result = await engine.evaluate({
        tenantId: 'tenant-1',
        agentId: 'agent-a',
        agentScopes: [],
        toolName: 'mystery_tool',
        toolArgs: {},
        requestId: 'req-invalid',
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/no matching policy/i);
    });
  });
});
