import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { PolicyEvaluator } from '@pgag/policy-engine';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { executeTool } from '../services/tool-executor.js';
import { estimateCost } from '../services/cost-estimator.js';
import { checkRateLimit, applyRateLimitHeaders } from '../services/rate-limiter.js';
import { logger } from '../logger.js';
import { metrics, METRIC } from '../metrics.js';
import { newTraceContext, parseTraceParent, gatewayEvent } from '../services/telemetry.js';
import type { PolicyRule } from '@pgag/shared';

// Strip prototype-polluting keys from toolArgs before persisting or executing.
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    safe[k] = v;
  }
  return safe;
}

const InvokeSchema = z.object({
  agentId: z.string().min(1),
  toolName: z.string().min(1),
  toolArgs: z.record(z.unknown()).default({}),
  traceId: z.string().optional(),
});

type DbPolicyStore = {
  getPoliciesForTenant(tenantId: string): Promise<PolicyRule[]>;
};

export async function gatewayRoutes(app: FastifyInstance) {
  /**
   * POST /v1/gateway/invoke
   *
   * Primary endpoint. Authenticates, rate-limits, evaluates policy, and either
   * executes the tool, blocks it, or queues it for human approval.
   */
  app.post(
    '/v1/gateway/invoke',
    { preHandler: authenticate },
    async (request, reply) => {
      const start = Date.now();

      // ── Parse and validate ────────────────────────────────────────────────
      const parsed = InvokeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'INVALID_REQUEST',
          message: 'Request body validation failed',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { agentId, toolName } = parsed.data;
      const toolArgs = sanitizeArgs(parsed.data.toolArgs);
      const db = getDb();

      // ── Trace context ─────────────────────────────────────────────────────
      const parentTraceId = parseTraceParent(
        request.headers['traceparent'] as string | undefined,
      );
      const traceCtx = newTraceContext(parsed.data.traceId ?? parentTraceId);
      const { traceId } = traceCtx;
      const requestId = uuidv4();

      // ── Rate limiting ─────────────────────────────────────────────────────
      const redis = (app as any).redis ?? null;
      const rateResult = await checkRateLimit(redis, request.tenantId, 'invoke');
      applyRateLimitHeaders(reply, rateResult, parseInt(process.env['RATE_LIMIT_MAX'] ?? '100', 10));

      if (!rateResult.allowed) {
        metrics.incCounter(METRIC.REQUEST_TOTAL, {
          tenant: request.tenantId,
          status: 'rate_limited',
        });
        return reply.status(429).send({
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded for this tenant',
          resetAt: new Date(rateResult.resetAt).toISOString(),
        });
      }

      // ── Resolve agent ─────────────────────────────────────────────────────
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);

      if (!agent || agent.tenantId !== request.tenantId) {
        return reply.status(404).send({
          code: 'AGENT_NOT_FOUND',
          message: `Agent '${agentId}' not found in this tenant`,
          requestId,
          traceId,
        });
      }

      // ── Write initial pending record ──────────────────────────────────────
      await db.insert(schema.gatewayRequests).values({
        id: requestId,
        tenantId: request.tenantId,
        agentId,
        agentName: agent.name,
        toolName,
        toolArgs,
        traceId,
        status: 'pending',
      });

      // ── Policy evaluation ─────────────────────────────────────────────────
      const policyStore: DbPolicyStore = {
        async getPoliciesForTenant(tenantId: string): Promise<PolicyRule[]> {
          const rows = await db
            .select()
            .from(schema.policies)
            .where(eq(schema.policies.tenantId, tenantId));

          return rows.map((r): PolicyRule => ({
            id: r.id,
            tenantId: r.tenantId,
            name: r.name,
            toolName: r.toolName,
            requiredScope: r.requiredScope ?? undefined,
            maxAmount: r.maxAmount ?? undefined,
            allowedAgentIds: (r.allowedAgentIds as string[] | null) ?? undefined,
            blockedAgentIds: (r.blockedAgentIds as string[] | null) ?? undefined,
            decision: r.decision as 'allow' | 'deny' | 'approval_required',
            reason: r.reason,
            priority: r.priority,
            enabled: r.enabled,
            createdAt: r.createdAt,
          }));
        },
      };

      const evaluator = new PolicyEvaluator(policyStore);
      const evalResult = await evaluator.evaluate({
        tenantId: request.tenantId,
        agentId,
        agentScopes: agent.scopes as string[],
        toolName,
        toolArgs,
        requestId,
      });

      metrics.incCounter(METRIC.POLICY_DECISIONS_TOTAL, {
        tenant: request.tenantId,
        decision: evalResult.decision,
        tool: toolName,
      });

      // ── Write policy decision record ──────────────────────────────────────
      await db.insert(schema.policyDecisions).values({
        id: uuidv4(),
        requestId,
        tenantId: request.tenantId,
        policyId: evalResult.matchedPolicyId,
        decision: evalResult.decision,
        reason: evalResult.reason,
      });

      const latencyMs = () => Date.now() - start;

      // ── DENY ──────────────────────────────────────────────────────────────
      if (evalResult.decision === 'deny') {
        const ms = latencyMs();

        await db
          .update(schema.gatewayRequests)
          .set({
            status: 'denied',
            decision: 'deny',
            decisionReason: evalResult.reason,
            matchedPolicyId: evalResult.matchedPolicyId,
            latencyMs: ms,
            resolvedAt: new Date(),
          })
          .where(eq(schema.gatewayRequests.id, requestId));

        await writeAuditLog(db, {
          tenantId: request.tenantId,
          requestId,
          agentId,
          action: 'policy.evaluated',
          outcome: 'success',
          traceId,
          detail: { decision: 'deny', reason: evalResult.reason, tool: toolName },
        });

        metrics.incCounter(METRIC.REQUEST_TOTAL, { tenant: request.tenantId, status: 'denied' });
        metrics.observeHistogram(METRIC.REQUEST_LATENCY_MS, ms, { tenant: request.tenantId });

        logger.info(
          'Gateway request denied',
          gatewayEvent({
            event: 'request.denied',
            traceId,
            requestId,
            tenantId: request.tenantId,
            agentId,
            toolName,
            decision: 'deny',
            reason: evalResult.reason,
            latencyMs: ms,
          }),
        );

        return reply.status(403).send({
          requestId,
          traceId,
          decision: 'deny',
          status: 'denied',
          reason: evalResult.reason,
          latencyMs: ms,
        });
      }

      // ── APPROVAL REQUIRED ─────────────────────────────────────────────────
      if (evalResult.decision === 'approval_required') {
        const approvalId = uuidv4();
        const ms = latencyMs();

        await db.insert(schema.approvals).values({
          id: approvalId,
          requestId,
          tenantId: request.tenantId,
          status: 'pending',
        });

        await db
          .update(schema.gatewayRequests)
          .set({
            status: 'approval_required',
            decision: 'approval_required',
            decisionReason: evalResult.reason,
            matchedPolicyId: evalResult.matchedPolicyId,
            latencyMs: ms,
          })
          .where(eq(schema.gatewayRequests.id, requestId));

        await writeAuditLog(db, {
          tenantId: request.tenantId,
          requestId,
          agentId,
          action: 'approval.requested',
          outcome: 'success',
          traceId,
          detail: { approvalId, reason: evalResult.reason, tool: toolName },
        });

        metrics.incCounter(METRIC.REQUEST_TOTAL, {
          tenant: request.tenantId,
          status: 'approval_required',
        });
        metrics.incCounter(METRIC.APPROVAL_PENDING, { tenant: request.tenantId });
        metrics.observeHistogram(METRIC.REQUEST_LATENCY_MS, ms, { tenant: request.tenantId });

        logger.info(
          'Gateway request requires approval',
          gatewayEvent({
            event: 'request.approval_required',
            traceId,
            requestId,
            tenantId: request.tenantId,
            agentId,
            toolName,
            decision: 'approval_required',
            reason: evalResult.reason,
            approvalId,
            latencyMs: ms,
          }),
        );

        return reply.status(202).send({
          requestId,
          traceId,
          decision: 'approval_required',
          status: 'approval_required',
          reason: evalResult.reason,
          approvalId,
          latencyMs: ms,
        });
      }

      // ── ALLOW: execute the tool ───────────────────────────────────────────
      let toolExecResult: Awaited<ReturnType<typeof executeTool>>;
      try {
        toolExecResult = await executeTool({ toolName, toolArgs });
      } catch (err) {
        // Tool execution failed — update the request to 'error' and write an
        // audit log so the failure is visible in the dashboard and trace.
        const ms = latencyMs();

        await db
          .update(schema.gatewayRequests)
          .set({ status: 'error', latencyMs: ms, resolvedAt: new Date() })
          .where(eq(schema.gatewayRequests.id, requestId));

        await writeAuditLog(db, {
          tenantId: request.tenantId,
          requestId,
          agentId,
          action: 'tool.executed',
          outcome: 'failure',
          traceId,
          detail: { tool: toolName, error: String(err) },
        });

        logger.error('Tool execution failed', {
          traceId,
          requestId,
          tenantId: request.tenantId,
          tool: toolName,
          error: String(err),
        });

        throw err; // Let Fastify's error handler return 500 to the caller.
      }

      const cost = estimateCost(toolName);
      const ms = latencyMs();

      await db
        .update(schema.gatewayRequests)
        .set({
          status: 'allowed',
          decision: 'allow',
          decisionReason: evalResult.reason,
          matchedPolicyId: evalResult.matchedPolicyId,
          toolResult: toolExecResult.data,
          latencyMs: ms,
          costEstimate: cost.costUsd,
          tokenCount: cost.inputTokens + cost.outputTokens,
          resolvedAt: new Date(),
        })
        .where(eq(schema.gatewayRequests.id, requestId));

      await db.insert(schema.costEvents).values({
        id: uuidv4(),
        requestId,
        tenantId: request.tenantId,
        agentId,
        toolName,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        costUsd: cost.costUsd,
        model: cost.model,
      });

      await writeAuditLog(db, {
        tenantId: request.tenantId,
        requestId,
        agentId,
        action: 'tool.executed',
        outcome: 'success',
        traceId,
        detail: {
          tool: toolName,
          executionMs: toolExecResult.executionMs,
          cost_usd: cost.costUsd,
          tokens: cost.inputTokens + cost.outputTokens,
        },
      });

      metrics.incCounter(METRIC.REQUEST_TOTAL, { tenant: request.tenantId, status: 'allowed' });
      metrics.incCounter(METRIC.TOOL_EXECUTIONS_TOTAL, {
        tenant: request.tenantId,
        tool: toolName,
      });
      metrics.observeHistogram(METRIC.REQUEST_LATENCY_MS, ms, { tenant: request.tenantId });

      logger.info(
        'Gateway request allowed and executed',
        gatewayEvent({
          event: 'request.allowed',
          traceId,
          requestId,
          tenantId: request.tenantId,
          agentId,
          toolName,
          decision: 'allow',
          latencyMs: ms,
          costEstimate: cost.costUsd,
        }),
      );

      return reply.status(200).send({
        requestId,
        traceId,
        decision: 'allow',
        status: 'allowed',
        reason: evalResult.reason,
        toolResult: toolExecResult.data,
        costEstimate: cost.costUsd,
        latencyMs: ms,
      });
    },
  );
}

export async function writeAuditLog(
  db: ReturnType<typeof getDb>,
  params: {
    tenantId: string;
    requestId: string;
    agentId: string;
    action: string;
    outcome: 'success' | 'failure';
    traceId: string;
    detail: Record<string, unknown>;
  },
) {
  await db.insert(schema.auditLogs).values({
    id: uuidv4(),
    tenantId: params.tenantId,
    requestId: params.requestId,
    agentId: params.agentId,
    action: params.action,
    outcome: params.outcome,
    traceId: params.traceId,
    detail: params.detail,
  });
}
