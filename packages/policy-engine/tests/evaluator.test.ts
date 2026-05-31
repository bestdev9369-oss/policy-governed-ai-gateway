import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../src/evaluator.js';
import type { PolicyStore } from '../src/types.js';
import type { PolicyRule } from '@pgag/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(policies: PolicyRule[]): PolicyStore {
  return {
    getPoliciesForTenant: async (tenantId: string) =>
      policies.filter((p) => p.tenantId === tenantId),
  };
}

function makePolicy(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'policy-001',
    tenantId: 'tenant-acme',
    name: 'Default allow lookup',
    toolName: 'lookup_customer',
    requiredScope: 'crm:read',
    decision: 'allow',
    reason: 'CRM read access is permitted',
    priority: 10,
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

const BASE_CTX = {
  tenantId: 'tenant-acme',
  agentId: 'agent-001',
  agentScopes: ['crm:read'],
  toolName: 'lookup_customer',
  toolArgs: {},
  requestId: 'req-001',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PolicyEvaluator', () => {
  let evaluator: PolicyEvaluator;

  describe('allow decision', () => {
    beforeEach(() => {
      evaluator = new PolicyEvaluator(makeStore([makePolicy()]));
    });

    it('allows a request when scope matches and policy is allow', async () => {
      const result = await evaluator.evaluate(BASE_CTX);
      expect(result.decision).toBe('allow');
      expect(result.matchedPolicyId).toBe('policy-001');
    });

    it('includes the matched policy name in the result', async () => {
      const result = await evaluator.evaluate(BASE_CTX);
      expect(result.matchedPolicyName).toBe('Default allow lookup');
    });
  });

  describe('deny decision', () => {
    it('denies when agent lacks required scope', async () => {
      const policy = makePolicy({ requiredScope: 'crm:admin' });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      const result = await evaluator.evaluate({ ...BASE_CTX, agentScopes: ['crm:read'] });
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/lacks required scope/i);
    });

    it('denies when agent is in blocklist', async () => {
      const policy = makePolicy({ blockedAgentIds: ['agent-001'], requiredScope: undefined });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      const result = await evaluator.evaluate(BASE_CTX);
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/explicitly blocked/i);
    });

    it('denies when amount exceeds maxAmount', async () => {
      const policy = makePolicy({
        toolName: 'wire_transfer',
        requiredScope: 'finance:write',
        maxAmount: 1000,
        decision: 'allow',
      });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      const result = await evaluator.evaluate({
        ...BASE_CTX,
        toolName: 'wire_transfer',
        agentScopes: ['finance:write'],
        toolArgs: { amount: 5000 },
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/exceeds maximum/i);
    });

    it('denies by default when no policy matches (fail-closed)', async () => {
      evaluator = new PolicyEvaluator(makeStore([]));
      const result = await evaluator.evaluate(BASE_CTX);
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/no matching policy/i);
    });

    it('denies when policy is disabled', async () => {
      const policy = makePolicy({ enabled: false });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      const result = await evaluator.evaluate(BASE_CTX);
      expect(result.decision).toBe('deny');
    });
  });

  describe('approval_required decision', () => {
    it('returns approval_required when policy specifies it', async () => {
      const policy = makePolicy({
        toolName: 'send_email',
        decision: 'approval_required',
        reason: 'Email sends require human approval',
        requiredScope: 'comms:send',
      });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      const result = await evaluator.evaluate({
        ...BASE_CTX,
        toolName: 'send_email',
        agentScopes: ['comms:send'],
      });
      expect(result.decision).toBe('approval_required');
      expect(result.reason).toMatch(/human approval/i);
    });
  });

  describe('tenant isolation', () => {
    it('does not apply policies from a different tenant', async () => {
      const policy = makePolicy({ tenantId: 'tenant-other' });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      // tenant-acme has no policies → fail-closed
      const result = await evaluator.evaluate({ ...BASE_CTX, tenantId: 'tenant-acme' });
      expect(result.decision).toBe('deny');
      expect(result.evaluatedPolicies).toBe(0);
    });
  });

  describe('policy priority', () => {
    it('applies higher-priority policy first when multiple match', async () => {
      const low = makePolicy({
        id: 'low',
        priority: 1,
        decision: 'allow',
        requiredScope: undefined,
      });
      const high = makePolicy({
        id: 'high',
        priority: 100,
        decision: 'deny',
        reason: 'High-priority deny wins',
        requiredScope: undefined,
      });
      evaluator = new PolicyEvaluator(makeStore([low, high]));
      const result = await evaluator.evaluate(BASE_CTX);
      expect(result.decision).toBe('deny');
      expect(result.matchedPolicyId).toBe('high');
    });
  });

  describe('amount extraction', () => {
    it('handles amount in different arg field names', async () => {
      const policy = makePolicy({
        toolName: 'wire_transfer',
        requiredScope: undefined,
        maxAmount: 500,
        decision: 'allow',
      });
      evaluator = new PolicyEvaluator(makeStore([policy]));

      for (const field of ['amount', 'value', 'transfer_amount', 'payment_amount']) {
        const result = await evaluator.evaluate({
          ...BASE_CTX,
          toolName: 'wire_transfer',
          toolArgs: { [field]: 1000 },
        });
        expect(result.decision).toBe('deny');
      }
    });

    it('allows when amount is within threshold', async () => {
      const policy = makePolicy({
        toolName: 'wire_transfer',
        requiredScope: undefined,
        maxAmount: 1000,
        decision: 'allow',
      });
      evaluator = new PolicyEvaluator(makeStore([policy]));
      const result = await evaluator.evaluate({
        ...BASE_CTX,
        toolName: 'wire_transfer',
        toolArgs: { amount: 500 },
      });
      expect(result.decision).toBe('allow');
    });
  });
});
