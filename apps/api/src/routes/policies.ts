import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

const CreatePolicySchema = z.object({
  name: z.string().min(1).max(128),
  toolName: z.string().min(1),
  requiredScope: z.string().optional(),
  maxAmount: z.number().positive().optional(),
  allowedAgentIds: z.array(z.string()).optional(),
  blockedAgentIds: z.array(z.string()).optional(),
  decision: z.enum(['allow', 'deny', 'approval_required']),
  reason: z.string().min(1).max(512),
  priority: z.number().int().min(0).max(1000).default(10),
  enabled: z.boolean().default(true),
});

export async function policyRoutes(app: FastifyInstance) {
  app.get(
    '/v1/policies',
    { preHandler: authenticate },
    async (request, reply) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.policies)
        .where(eq(schema.policies.tenantId, request.tenantId))
        .orderBy(schema.policies.priority);

      return reply.send({ data: rows });
    },
  );

  app.post(
    '/v1/policies',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = CreatePolicySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'INVALID_REQUEST',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const db = getDb();
      const id = uuidv4();

      await db.insert(schema.policies).values({
        id,
        tenantId: request.tenantId,
        ...parsed.data,
      });

      const [created] = await db
        .select()
        .from(schema.policies)
        .where(eq(schema.policies.id, id))
        .limit(1);

      return reply.status(201).send(created);
    },
  );
}
