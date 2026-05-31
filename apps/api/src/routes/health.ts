import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { metrics, METRIC } from '../metrics.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      service: 'pgag-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req, reply) => {
    try {
      const db = getDb();
      await db.execute('SELECT 1' as any);
      return reply.send({
        status: 'ready',
        checks: { database: 'ok' },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.status(503).send({
        status: 'not_ready',
        checks: { database: 'error' },
        error: String(err),
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return reply.send(metrics.renderPrometheus());
  });
}
