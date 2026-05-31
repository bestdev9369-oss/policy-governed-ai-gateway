import type { PolicyRule } from '@pgag/shared';
import type { EvaluationContext, EvaluationResult, PolicyStore } from './types.js';

/**
 * PolicyEvaluator is the core decision engine.
 *
 * Evaluation order:
 *   1. Sort active policies by priority (descending — higher priority wins).
 *   2. Walk each policy; check all conditions as gates.
 *      - If any condition fails, the policy is SKIPPED (not a match).
 *      - Track the rejection reason for use in the fail-closed response.
 *   3. First policy whose ALL conditions pass determines the outcome.
 *   4. If no policy matches, fail-closed: deny with the last rejection reason.
 *
 * Intentionally pure and side-effect-free — the caller owns persistence and telemetry.
 */
export class PolicyEvaluator {
  constructor(private readonly store: PolicyStore) {}

  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const policies = await this.store.getPoliciesForTenant(ctx.tenantId);

    const active = policies
      .filter((p) => p.enabled && p.toolName === ctx.toolName)
      .sort((a, b) => b.priority - a.priority);

    // Track the most-recent condition-rejection reason so fail-closed denials
    // carry a useful diagnostic message rather than a generic fallback.
    let lastRejectionReason: string | null = null;

    for (const policy of active) {
      const rejection = this.checkConditions(policy, ctx);

      if (rejection !== null) {
        // A condition failed — this policy does not apply. Record why.
        lastRejectionReason = rejection;
        continue;
      }

      // All conditions passed — this policy fires.
      return {
        decision: policy.decision,
        reason: policy.reason,
        matchedPolicyId: policy.id,
        matchedPolicyName: policy.name,
        evaluatedPolicies: active.length,
      };
    }

    // Fail-closed: no policy matched.
    return {
      decision: 'deny',
      reason: lastRejectionReason ?? 'No matching policy found. Default action is deny (fail-closed).',
      evaluatedPolicies: active.length,
    };
  }

  /**
   * Check all conditions for a policy against the request context.
   * Returns null if ALL conditions pass (policy can fire).
   * Returns a non-null rejection reason string if any condition fails.
   */
  private checkConditions(policy: PolicyRule, ctx: EvaluationContext): string | null {
    // Scope gate — agent must hold the required scope.
    if (policy.requiredScope) {
      if (!ctx.agentScopes.includes(policy.requiredScope)) {
        return `Agent lacks required scope '${policy.requiredScope}' for tool '${ctx.toolName}'. Policy: ${policy.name}`;
      }
    }

    // Agent allowlist gate — agent must be explicitly listed.
    if (policy.allowedAgentIds && policy.allowedAgentIds.length > 0) {
      if (!policy.allowedAgentIds.includes(ctx.agentId)) {
        return `Agent '${ctx.agentId}' is not in the allowlist for policy '${policy.name}'`;
      }
    }

    // Agent blocklist gate — agent must NOT be listed.
    if (policy.blockedAgentIds && policy.blockedAgentIds.length > 0) {
      if (policy.blockedAgentIds.includes(ctx.agentId)) {
        return `Agent '${ctx.agentId}' is explicitly blocked by policy '${policy.name}'`;
      }
    }

    // Amount threshold gate — toolArgs amount must be within the allowed maximum.
    if (policy.maxAmount !== undefined && policy.maxAmount !== null) {
      const amount = this.extractAmount(ctx.toolArgs);
      if (amount !== null && amount > policy.maxAmount) {
        return `Amount ${amount} exceeds maximum allowed ${policy.maxAmount} for tool '${ctx.toolName}'. Policy: ${policy.name}`;
      }
    }

    return null; // All conditions passed.
  }

  private extractAmount(toolArgs: Record<string, unknown>): number | null {
    const raw =
      toolArgs['amount'] ??
      toolArgs['value'] ??
      toolArgs['transfer_amount'] ??
      toolArgs['payment_amount'];

    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const parsed = parseFloat(raw);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }
}
