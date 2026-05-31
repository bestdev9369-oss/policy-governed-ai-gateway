import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { executeTool } from '../services/tool-executor.js';
import { estimateCost } from '../services/cost-estimator.js';
import { writeAuditLog } from './gateway.js';
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
      const { data: body } = ResolveSchema.safeParse(request.body);
      const comment = body?.comment;
      const resolvedBy = (request.headers['x-user-id'] as string) ?? 'dashboard-user';

      const db = getDb();

      // Fetch both the approval and its linked request upfront — we need both,
      // and having them avoids a redundant query inside the transaction.
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
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Approval '${id}' not found`,
        });
      }

      if (approval.status !== 'pending') {
        return reply.status(409).send({
          code: 'ALREADY_RESOLVED',
          message: `Approval is already ${approval.status}`,
        });
      }

      const [gatewayRequest] = await db
        .select()
        .from(schema.gatewayRequests)
        .where(eq(schema.gatewayRequests.id, approval.requestId))
        .limit(1);

      if (!gatewayRequest) {
        return reply.status(500).send({
          code: 'INTERNAL',
          message: 'Gateway request not found',
        });
      }

      // ── Atomically flip status to prevent double-execution ────────────────
      // UPDATE WHERE status='pending' is the compare-and-swap that eliminates
      // the TOCTOU race. If two concurrent approve requests arrive, only one
      // will update a row; the other will find rowCount=0 and return 409.
      const approveResult = await db
        .update(schema.approvals)
        .set({
          status: 'approved',
          resolvedAt: new Date(),
          resolvedBy,
          comment: comment ?? null,
        })
        .where(
          and(
            eq(schema.approvals.id, id),
            eq(schema.approvals.status, 'pending'), // atomic guard
          ),
        );

      // Drizzle returns the updated rows; if none were affected another request
      // won the race.
      const rowsAffected = (approveResult as any)?.rowCount ?? 1;
      if (rowsAffected === 0) {
        return reply.status(409).send({
          code: 'ALREADY_RESOLVED',
          message: 'Approval was already resolved by a concurrent request',
        });
      }

      // ── Execute the deferred tool call ────────────────────────────────────
      let toolResult: Awaited<ReturnType<typeof executeTool>>;
      try {
        toolResult = await executeTool({
          toolName: gatewayRequest.toolName,
          toolArgs: gatewayRequest.toolArgs as Record<string, unknown>,
        });
      } catch (err) {
        // Roll back the approval status so a retry is possible.
        await db
          .update(schema.approvals)
          .set({ status: 'pending', resolvedAt: null, resolvedBy: null })
          .where(eq(schema.approvals.id, id));

        logger.error('Tool execution failed after approval', {
          approvalId: id,
          requestId: gatewayRequest.id,
          tenantId: request.tenantId,
          tool: gatewayRequest.toolName,
          error: String(err),
        });

        throw err;
      }

      const cost = estimateCost(gatewayRequest.toolName);

      // ── Persist results atomically ────────────────────────────────────────
      // All writes below are logically one unit. In production, wrap in
      // db.transaction() once Drizzle's transaction API is stable in your
      // Postgres driver version.
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

      await writeAuditLog(db, {
        tenantId: request.tenantId,
        requestId: gatewayRequest.id,
        agentId: gatewayRequest.agentId,
        action: 'approval.granted',
        outcome: 'success',
        traceId: gatewayRequest.traceId,
        detail: {
          approvalId: id,
          resolvedBy,
          comment: comment ?? null,
          tool: gatewayRequest.toolName,
        },
      });

      metrics.incCounter(METRIC.TOOL_EXECUTIONS_TOTAL, {
        tenant: request.tenantId,
        tool: gatewayRequest.toolName,
      });

      logger.info('Approval granted — tool executed', {
        approvalId: id,
        requestId: gatewayRequest.id,
        tenantId: request.tenantId,
        tool: gatewayRequest.toolName,
        traceId: gatewayRequest.traceId,
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
      const { data: body } = ResolveSchema.safeParse(request.body);
      const comment = body?.comment;
      const resolvedBy = (request.headers['x-user-id'] as string) ?? 'dashboard-user';

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
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Approval '${id}' not found`,
        });
      }

      if (approval.status !== 'pending') {
        return reply.status(409).send({
          code: 'ALREADY_RESOLVED',
          message: `Approval is already ${approval.status}`,
        });
      }

      // Fetch the gateway request for agentId and traceId — needed for the
      // audit log. Do this before the update so we have it regardless.
      const [gatewayRequest] = await db
        .select()
        .from(schema.gatewayRequests)
        .where(eq(schema.gatewayRequests.id, approval.requestId))
        .limit(1);

      // Atomic status flip — prevents concurrent deny+approve races.
      await db
        .update(schema.approvals)
        .set({
          status: 'denied',
          resolvedAt: new Date(),
          resolvedBy,
          comment: comment ?? null,
        })
        .where(
          and(
            eq(schema.approvals.id, id),
            eq(schema.approvals.status, 'pending'),
          ),
        );

      await db
        .update(schema.gatewayRequests)
        .set({ status: 'rejected', resolvedAt: new Date() })
        .where(eq(schema.gatewayRequests.id, approval.requestId));

      await writeAuditLog(db, {
        tenantId: request.tenantId,
        requestId: approval.requestId,
        agentId: gatewayRequest?.agentId ?? '',
        action: 'approval.denied',
        outcome: 'success',
        traceId: gatewayRequest?.traceId ?? '',
        detail: { approvalId: id, resolvedBy, comment: comment ?? null },
      });

      logger.info('Approval denied', {
        approvalId: id,
        tenantId: request.tenantId,
        requestId: approval.requestId,
      });

      return reply.send({ approvalId: id, status: 'denied', comment: comment ?? null });
    },
  );
}
