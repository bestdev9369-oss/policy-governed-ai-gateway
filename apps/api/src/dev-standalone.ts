/**
 * Standalone development server — no Docker, no external dependencies.
 *
 * Uses pg-mem for an in-memory PostgreSQL-compatible database.
 * Redis is not required: the rate limiter fails open gracefully when
 * no Redis connection is available.
 *
 * Starts in < 2 seconds. Data is reset on each restart.
 *
 * Usage:
 *   pnpm --filter @pgag/api dev:standalone
 *   # API at http://localhost:3000
 *   # Dashboard (separate terminal): pnpm --filter @pgag/web dev
 */

import { createMemDb } from './db/mem.js';
import { injectDb } from './db/index.js';
import { buildServer } from './server.js';
import { logger } from './logger.js';

// Minimal env defaults so the server starts cleanly
process.env['NODE_ENV'] ??= 'development';
process.env['LOG_LEVEL'] ??= 'info';
process.env['PORT'] ??= '3000';
process.env['HOST'] ??= '0.0.0.0';
process.env['SEED_TENANT_API_KEY'] ??= 'demo-tenant-key-acme';
process.env['SEED_ADMIN_API_KEY'] ??= 'demo-admin-key-internal';
// Tell the rate limiter there is no Redis — it will fail open.
// The REDIS_URL env is intentionally NOT set.

logger.info('Starting standalone server with in-memory database (pg-mem)');

const { db } = await createMemDb();
injectDb(db);

const app = await buildServer();
const port = parseInt(process.env['PORT'], 10);
const host = process.env['HOST'];

await app.listen({ port, host });

logger.info('Standalone server ready', {
  port,
  dashboard: 'http://localhost:5173  (run: pnpm --filter @pgag/web dev)',
  api: `http://localhost:${port}`,
  note: 'In-memory DB — data resets on restart. No Docker required.',
});

logger.info('Demo API key: demo-tenant-key-acme  (X-API-Key header)');
