import type { PolicyDecision, PolicyRule } from '@pgag/shared';

// ─── Evaluation context ────────────────────────────────────────────────────────

export interface EvaluationContext {
  tenantId: string;
  agentId: string;
  agentScopes: string[];
  toolName: string;
  toolArgs: Record<string, unknown>;
  requestId: string;
}

// ─── Evaluation result ────────────────────────────────────────────────────────

export interface EvaluationResult {
  decision: PolicyDecision;
  reason: string;
  matchedPolicyId?: string;
  matchedPolicyName?: string;
  evaluatedPolicies: number;
}

// ─── Policy store interface ────────────────────────────────────────────────────

export interface PolicyStore {
  getPoliciesForTenant(tenantId: string): Promise<PolicyRule[]>;
}
