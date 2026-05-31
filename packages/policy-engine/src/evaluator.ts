import type { PolicyRule } from '@pgag/shared';
import type { EvaluationContext, EvaluationResult, PolicyStore } from './types.js';

/**
 * PolicyEvaluator — the core, stateless decision engine.
 *
 * Evaluation order:
 *   1. Load active policies for the tenant, sorted by priority descending.
 *   2. For each policy, run all conditions as gates.
 *      - A failed condition means this policy does NOT apply — skip it.
 *      - Record the first rejection reason for diagnostic reporting.
 *   3. First policy whose conditions ALL pass determines the outcome.
 *   4. If no policy matches: fail-closed (deny), surfacing the highest-priority
 *      rejection reason to help operators debug access configuration.
 *
 * Intentionally pure and side-effect-free. The caller owns all I/O.
 */
export class PolicyEvaluator {
  constructor(private readonly store: PolicyStore) {}

  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const policies = await this.store.getPoliciesForTenant(ctx.tenantId);

    const active = policies
      .filter((p) => p.enabled && p.toolName === ctx.toolName)
      .sort((a, b) => b.priority - a.priority);

    // Capture the FIRST rejection reason (from the highest-priority policy that
    // almost-matched). This surfaces the most operationally relevant diagnostic
    // rather than a low-priority policy's message.
    let firstRejectionReason: string | null = null;

    for (const policy of active) {
      const rejection = this.checkConditions(policy, ctx);

      if (rejection !== null) {
        // Condition gate failed — this policy does not apply.
        if (firstRejectionReason === null) {
          firstRejectionReason = rejection;
        }
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

    // Fail-closed: deny by default, with the best available diagnostic.
    return {
      decision: 'deny',
      reason:
        firstRejectionReason ??
        'No matching policy found. Default action is deny (fail-closed).',
      evaluatedPolicies: active.length,
    };
  }

  /**
   * Check all conditions for a policy against the request context.
   * Returns null if ALL conditions pass (policy is eligible to fire).
   * Returns a rejection reason string if any condition fails.
   */
  private checkConditions(policy: PolicyRule, ctx: EvaluationContext): string | null {
    // Scope gate — agent must hold the required scope.
    if (policy.requiredScope) {
      if (!ctx.agentScopes.includes(policy.requiredScope)) {
        return (
          `Agent lacks required scope '${policy.requiredScope}' ` +
          `for tool '${ctx.toolName}'. Policy: ${policy.name}`
        );
      }
    }

    // Allowlist gate — if set, agent must be explicitly listed.
    if (policy.allowedAgentIds && policy.allowedAgentIds.length > 0) {
      if (!policy.allowedAgentIds.includes(ctx.agentId)) {
        return `Agent '${ctx.agentId}' is not in the allowlist for policy '${policy.name}'`;
      }
    }

    // Blocklist gate — agent must NOT appear in this list.
    if (policy.blockedAgentIds && policy.blockedAgentIds.length > 0) {
      if (policy.blockedAgentIds.includes(ctx.agentId)) {
        return `Agent '${ctx.agentId}' is explicitly blocked by policy '${policy.name}'`;
      }
    }

    // Amount threshold gate — extract amount from well-known toolArg fields.
    if (policy.maxAmount !== undefined && policy.maxAmount !== null) {
      const amount = this.extractAmount(ctx.toolArgs);
      if (amount !== null && amount > policy.maxAmount) {
        return (
          `Amount ${amount} exceeds maximum ${policy.maxAmount} ` +
          `for tool '${ctx.toolName}'. Policy: ${policy.name}`
        );
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
