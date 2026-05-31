import 'dotenv/config';
import { buildServer } from './server.js';
import { logger } from './logger.js';
import { closeDb } from './db/index.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = await buildServer();

try {
  await app.listen({ port: PORT, host: HOST });
  logger.info('API server started', { port: PORT, host: HOST, env: process.env['NODE_ENV'] });
} catch (err) {
  logger.fatal('Failed to start server', { error: String(err) });
  process.exit(1);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  try {
    await app.close();
    await closeDb();
    logger.info('Server closed cleanly');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: String(err) });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
