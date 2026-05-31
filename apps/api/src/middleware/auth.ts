import type { FastifyRequest, FastifyReply } from 'fastify';
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
 * API key authentication — validates X-API-Key and attaches tenant context.
 *
 * Production upgrade path: replace with short-lived JWT tokens issued by an
 * OIDC provider (Auth0, Keycloak). API keys then become M2M service accounts
 * only, hashed at rest with Argon2.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(401).send({
      code: 'MISSING_API_KEY',
      message: 'X-API-Key header is required',
    });
  }

  const db = getDb();

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.apiKey, apiKey))
    .limit(1);

  if (!tenant) {
    logger.warn('Authentication failed: invalid API key', {
      apiKey: apiKey.slice(0, 8) + '...',
    });
    return reply.status(401).send({
      code: 'INVALID_API_KEY',
      message: 'API key is invalid or has been revoked',
    });
  }

  request.tenantId = tenant.id;
  request.tenantName = tenant.name;
  request.apiKey = apiKey;
}

/**
 * Admin guard — must be chained after `authenticate`.
 * Checks that the caller holds the designated admin API key.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminKey = process.env['SEED_ADMIN_API_KEY'];

  if (!adminKey || request.headers['x-api-key'] !== adminKey) {
    // Return is critical here — without it Fastify continues into the route handler
    return reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
}
