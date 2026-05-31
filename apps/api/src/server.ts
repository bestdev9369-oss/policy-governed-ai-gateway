import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pinoConfig } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { gatewayRoutes } from './routes/gateway.js';
import { requestRoutes } from './routes/requests.js';
import { auditRoutes } from './routes/audit.js';
import { policyRoutes } from './routes/policies.js';
import { approvalRoutes } from './routes/approvals.js';

export async function buildServer() {
  const app = Fastify({
    logger: pinoConfig,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
    genReqId: () => crypto.randomUUID(),
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Request-Id', 'X-User-Id', 'traceparent'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(gatewayRoutes);
  await app.register(requestRoutes);
  await app.register(auditRoutes);
  await app.register(policyRoutes);
  await app.register(approvalRoutes);

  // ── Global error handler ────────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    app.log.error({ requestId, err: error }, 'Unhandled error');

    const status = error.statusCode ?? 500;
    reply.status(status).send({
      code: error.code ?? 'INTERNAL_ERROR',
      message: status === 500 ? 'An internal error occurred' : error.message,
      requestId,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  return app;
}
