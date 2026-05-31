import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  agentId: z.string().optional(),
  toolName: z.string().optional(),
});

export async function requestRoutes(app: FastifyInstance) {
  app.get(
    '/v1/requests',
    { preHandler: authenticate },
    async (request, reply) => {
      const query = QuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ code: 'INVALID_QUERY', errors: query.error.flatten() });
      }

      const { page, pageSize, status, agentId, toolName } = query.data;
      const db = getDb();

      const conditions = [eq(schema.gatewayRequests.tenantId, request.tenantId)];
      if (status) conditions.push(eq(schema.gatewayRequests.status, status as any));
      if (agentId) conditions.push(eq(schema.gatewayRequests.agentId, agentId));
      if (toolName) conditions.push(eq(schema.gatewayRequests.toolName, toolName));

      const rows = await db
        .select()
        .from(schema.gatewayRequests)
        .where(and(...conditions))
        .orderBy(desc(schema.gatewayRequests.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return reply.send({ data: rows, page, pageSize });
    },
  );

  app.get(
    '/v1/requests/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [req] = await db
        .select()
        .from(schema.gatewayRequests)
        .where(
          and(
            eq(schema.gatewayRequests.id, id),
            eq(schema.gatewayRequests.tenantId, request.tenantId),
          ),
        )
        .limit(1);

      if (!req) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: `Request '${id}' not found` });
      }

      // Eagerly load related records
      const [decision] = await db
        .select()
        .from(schema.policyDecisions)
        .where(eq(schema.policyDecisions.requestId, id))
        .limit(1);

      const [approval] = await db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.requestId, id))
        .limit(1);

      const [costEvent] = await db
        .select()
        .from(schema.costEvents)
        .where(eq(schema.costEvents.requestId, id))
        .limit(1);

      const logs = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.requestId, id))
        .orderBy(schema.auditLogs.createdAt);

      return reply.send({
        request: req,
        policyDecision: decision ?? null,
        approval: approval ?? null,
        costEvent: costEvent ?? null,
        auditLogs: logs,
      });
    },
  );
}
