import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  action: z.string().optional(),
  agentId: z.string().optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    '/v1/audit-logs',
    { preHandler: authenticate },
    async (request, reply) => {
      const query = QuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ code: 'INVALID_QUERY', errors: query.error.flatten() });
      }

      const { page, pageSize, action, agentId } = query.data;
      const db = getDb();

      const conditions = [eq(schema.auditLogs.tenantId, request.tenantId)];
      if (action) conditions.push(eq(schema.auditLogs.action, action));
      if (agentId) conditions.push(eq(schema.auditLogs.agentId, agentId));

      const rows = await db
        .select()
        .from(schema.auditLogs)
        .where(and(...conditions))
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return reply.send({ data: rows, page, pageSize });
    },
  );
}
