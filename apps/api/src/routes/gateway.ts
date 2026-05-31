import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { PolicyEvaluator } from '@pgag/policy-engine';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { executeTool } from '../services/tool-executor.js';
import { estimateCost } from '../services/cost-estimator.js';
import { checkRateLimit } from '../services/rate-limiter.js';
import { logger } from '../logger.js';
import { metrics, METRIC } from '../metrics.js';
import { newTraceContext, parseTraceParent, gatewayEvent } from '../services/telemetry.js';
import type { PolicyRule } from '@pgag/shared';

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
   * The primary endpoint. Accepts a tool invocation request, evaluates
   * policies, executes (or blocks) the tool, and writes the full audit trail.
   */
  app.post(
    '/v1/gateway/invoke',
    { preHandler: authenticate },
    async (request, reply) => {
      const start = Date.now();

      // ── Parse and validate input ─────────────────────────────────────────
      const parsed = InvokeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'INVALID_REQUEST',
          message: 'Request body validation failed',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { agentId, toolName, toolArgs } = parsed.data;
      const db = getDb();

      // ── Establish trace context ──────────────────────────────────────────
      const parentTraceId = parseTraceParent(request.headers['traceparent'] as string | undefined);
      const traceCtx = newTraceContext(parsed.data.traceId ?? parentTraceId);
      const { traceId } = traceCtx;
      const requestId = uuidv4();

      // ── Rate limiting ───────────────────────────────────────────────────
      const redis = (app as any).redis ?? null;
      const rateCheck = await checkRateLimit(redis, request.tenantId, 'invoke');
      if (!rateCheck.allowed) {
        metrics.incCounter(METRIC.REQUEST_TOTAL, { tenant: request.tenantId, status: 'rate_limited' });
        return reply.status(429).send({
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded for this tenant',
          resetAt: new Date(rateCheck.resetAt).toISOString(),
        });
      }

      // ── Resolve agent ────────────────────────────────────────────────────
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

      // ── Write initial request record ─────────────────────────────────────
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

      // ── Policy evaluation ────────────────────────────────────────────────
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

      // ── Write policy decision record ─────────────────────────────────────
      await db.insert(schema.policyDecisions).values({
        id: uuidv4(),
        requestId,
        tenantId: request.tenantId,
        policyId: evalResult.matchedPolicyId,
        decision: evalResult.decision,
        reason: evalResult.reason,
      });

      // ── Branch on decision ───────────────────────────────────────────────
      let toolResult: Record<string, unknown> | undefined;
      let finalStatus: string;
      let latencyMs: number;
      let costEstimate: number | undefined;

      if (evalResult.decision === 'deny') {
        finalStatus = 'denied';

        await db
          .update(schema.gatewayRequests)
          .set({
            status: 'denied',
            decision: 'deny',
            decisionReason: evalResult.reason,
            matchedPolicyId: evalResult.matchedPolicyId,
            latencyMs: Date.now() - start,
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

        latencyMs = Date.now() - start;
        metrics.incCounter(METRIC.REQUEST_TOTAL, { tenant: request.tenantId, status: 'denied' });
        metrics.observeHistogram(METRIC.REQUEST_LATENCY_MS, latencyMs, { tenant: request.tenantId });

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
            latencyMs,
          }),
        );

        return reply.status(403).send({
          requestId,
          traceId,
          decision: 'deny',
          status: 'denied',
          reason: evalResult.reason,
          costEstimate: 0,
          latencyMs,
        });
      }

      if (evalResult.decision === 'approval_required') {
        finalStatus = 'approval_required';

        const approvalId = uuidv4();
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
            latencyMs: Date.now() - start,
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

        latencyMs = Date.now() - start;
        metrics.incCounter(METRIC.REQUEST_TOTAL, { tenant: request.tenantId, status: 'approval_required' });
        metrics.incCounter(METRIC.APPROVAL_PENDING, { tenant: request.tenantId });
        metrics.observeHistogram(METRIC.REQUEST_LATENCY_MS, latencyMs, { tenant: request.tenantId });

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
            latencyMs,
          }),
        );

        return reply.status(202).send({
          requestId,
          traceId,
          decision: 'approval_required',
          status: 'approval_required',
          reason: evalResult.reason,
          approvalId,
          costEstimate: 0,
          latencyMs,
        });
      }

      // ── decision === 'allow': execute the tool ───────────────────────────
      const toolExecResult = await executeTool({ toolName, toolArgs });
      const cost = estimateCost(toolName);
      finalStatus = 'allowed';
      latencyMs = Date.now() - start;
      costEstimate = cost.costUsd;

      await db
        .update(schema.gatewayRequests)
        .set({
          status: 'allowed',
          decision: 'allow',
          decisionReason: evalResult.reason,
          matchedPolicyId: evalResult.matchedPolicyId,
          toolResult: toolExecResult.data,
          latencyMs,
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
      metrics.incCounter(METRIC.TOOL_EXECUTIONS_TOTAL, { tenant: request.tenantId, tool: toolName });
      metrics.observeHistogram(METRIC.REQUEST_LATENCY_MS, latencyMs, { tenant: request.tenantId });

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
          latencyMs,
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
        latencyMs,
      });
    },
  );
}

async function writeAuditLog(
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
