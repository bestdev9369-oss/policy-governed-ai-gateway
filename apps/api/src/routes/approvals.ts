import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { executeTool } from '../services/tool-executor.js';
import { estimateCost } from '../services/cost-estimator.js';
import { logger } from '../logger.js';
import { metrics, METRIC } from '../metrics.js';

const ResolveSchema = z.object({
  comment: z.string().max(512).optional(),
});

export async function approvalRoutes(app: FastifyInstance) {
  app.post(
    '/v1/approvals/:id/approve',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ResolveSchema.safeParse(request.body);
      const comment = parsed.success ? parsed.data.comment : undefined;

      const db = getDb();

      const [approval] = await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.id, id),
            eq(schema.approvals.tenantId, request.tenantId),
          ),
        )
        .limit(1);

      if (!approval) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: `Approval '${id}' not found` });
      }

      if (approval.status !== 'pending') {
        return reply.status(409).send({
          code: 'ALREADY_RESOLVED',
          message: `Approval is already ${approval.status}`,
        });
      }

      // ── Execute the deferred tool call ──────────────────────────────────
      const [gatewayRequest] = await db
        .select()
        .from(schema.gatewayRequests)
        .where(eq(schema.gatewayRequests.id, approval.requestId))
        .limit(1);

      if (!gatewayRequest) {
        return reply.status(500).send({ code: 'INTERNAL', message: 'Gateway request not found' });
      }

      const toolResult = await executeTool({
        toolName: gatewayRequest.toolName,
        toolArgs: gatewayRequest.toolArgs as Record<string, unknown>,
      });

      const cost = estimateCost(gatewayRequest.toolName);

      // ── Persist approval resolution ──────────────────────────────────────
      await db
        .update(schema.approvals)
        .set({
          status: 'approved',
          resolvedAt: new Date(),
          resolvedBy: request.headers['x-user-id'] as string ?? 'dashboard-user',
          comment,
        })
        .where(eq(schema.approvals.id, id));

      await db
        .update(schema.gatewayRequests)
        .set({
          status: 'approved',
          toolResult: toolResult.data,
          costEstimate: cost.costUsd,
          tokenCount: cost.inputTokens + cost.outputTokens,
          resolvedAt: new Date(),
        })
        .where(eq(schema.gatewayRequests.id, gatewayRequest.id));

      await db.insert(schema.costEvents).values({
        id: uuidv4(),
        requestId: gatewayRequest.id,
        tenantId: request.tenantId,
        agentId: gatewayRequest.agentId,
        toolName: gatewayRequest.toolName,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        costUsd: cost.costUsd,
        model: cost.model,
      });

      await db.insert(schema.auditLogs).values({
        id: uuidv4(),
        tenantId: request.tenantId,
        requestId: gatewayRequest.id,
        agentId: gatewayRequest.agentId,
        action: 'approval.granted',
        outcome: 'success',
        traceId: gatewayRequest.traceId,
        detail: { approvalId: id, comment, tool: gatewayRequest.toolName },
      });

      metrics.incCounter(METRIC.TOOL_EXECUTIONS_TOTAL, {
        tenant: request.tenantId,
        tool: gatewayRequest.toolName,
      });

      logger.info('Approval granted, tool executed', {
        approvalId: id,
        requestId: gatewayRequest.id,
        tenantId: request.tenantId,
        tool: gatewayRequest.toolName,
      });

      return reply.send({
        approvalId: id,
        status: 'approved',
        toolResult: toolResult.data,
        costEstimate: cost.costUsd,
      });
    },
  );

  app.post(
    '/v1/approvals/:id/deny',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ResolveSchema.safeParse(request.body);
      const comment = parsed.success ? parsed.data.comment : undefined;

      const db = getDb();

      const [approval] = await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.id, id),
            eq(schema.approvals.tenantId, request.tenantId),
          ),
        )
        .limit(1);

      if (!approval) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: `Approval '${id}' not found` });
      }

      if (approval.status !== 'pending') {
        return reply.status(409).send({ code: 'ALREADY_RESOLVED', message: `Approval is already ${approval.status}` });
      }

      await db
        .update(schema.approvals)
        .set({
          status: 'denied',
          resolvedAt: new Date(),
          resolvedBy: request.headers['x-user-id'] as string ?? 'dashboard-user',
          comment,
        })
        .where(eq(schema.approvals.id, id));

      await db
        .update(schema.gatewayRequests)
        .set({ status: 'rejected', resolvedAt: new Date() })
        .where(eq(schema.gatewayRequests.id, approval.requestId));

      await db.insert(schema.auditLogs).values({
        id: uuidv4(),
        tenantId: request.tenantId,
        requestId: approval.requestId,
        action: 'approval.denied',
        outcome: 'success',
        traceId: (await db.select().from(schema.gatewayRequests).where(eq(schema.gatewayRequests.id, approval.requestId)).limit(1))[0]?.traceId ?? '',
        detail: { approvalId: id, comment },
      });

      logger.info('Approval denied', { approvalId: id, tenantId: request.tenantId });

      return reply.send({ approvalId: id, status: 'denied', comment });
    },
  );
}
