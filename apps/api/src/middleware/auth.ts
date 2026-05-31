import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { logger } from '../logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    tenantName: string;
    apiKey: string;
  }
}

/**
 * API key authentication middleware.
 *
 * Tenants authenticate by passing their API key in the X-API-Key header.
 * In production, use short-lived JWT tokens issued by an OIDC provider, with
 * API keys only for machine-to-machine service accounts.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    reply.status(401).send({
      code: 'MISSING_API_KEY',
      message: 'X-API-Key header is required',
    });
    return;
  }

  const db = getDb();

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.apiKey, apiKey))
    .limit(1);

  if (!tenant) {
    logger.warn('Authentication failed: invalid API key', { apiKey: apiKey.slice(0, 8) + '...' });
    reply.status(401).send({
      code: 'INVALID_API_KEY',
      message: 'API key is invalid or has been revoked',
    });
    return;
  }

  request.tenantId = tenant.id;
  request.tenantName = tenant.name;
  request.apiKey = apiKey;
}

/**
 * Admin-only routes — tenant admin users only.
 * For demo purposes, the admin key is fixed in .env.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminKey = process.env['SEED_ADMIN_API_KEY'];
  const apiKey = request.headers['x-api-key'];

  if (!adminKey || apiKey !== adminKey) {
    reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
}
