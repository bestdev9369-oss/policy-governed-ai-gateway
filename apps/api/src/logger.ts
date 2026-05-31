import type { FastifyBaseLogger } from 'fastify';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function getConfiguredLevel(): LogLevel {
  const raw = process.env['LOG_LEVEL'] ?? 'info';
  return (raw as LogLevel) in LEVELS ? (raw as LogLevel) : 'info';
}

/**
 * Structured JSON logger — in production, pipe to your log aggregator
 * (Datadog, Loki, CloudWatch). The trace_id field is the primary join key
 * for correlating with OpenTelemetry spans.
 */
export function createLogger() {
  const configuredLevel = getConfiguredLevel();
  const configuredLevelNum = LEVELS[configuredLevel];

  function write(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
    if (LEVELS[level] < configuredLevelNum) return;

    const entry = {
      time: new Date().toISOString(),
      level,
      msg,
      service: process.env['OTEL_SERVICE_NAME'] ?? 'pgag-api',
      ...extra,
    };
    // Write one JSON line per log entry — plays nicely with log aggregators
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  return {
    trace: (msg: string, extra?: Record<string, unknown>) => write('trace', msg, extra),
    debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
    fatal: (msg: string, extra?: Record<string, unknown>) => write('fatal', msg, extra),
  };
}

export const logger = createLogger();

// Fastify-compatible pino config for request logging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pinoConfig: any = {
  level: getConfiguredLevel(),
  serializers: {
    req(req: { method: string; url: string; headers: Record<string, string | string[] | undefined> }) {
      const traceId = req.headers['x-trace-id'];
      return {
        method: req.method,
        url: req.url,
        trace_id: Array.isArray(traceId) ? traceId[0] : traceId,
      };
    },
  },
};

export type AppLogger = ReturnType<typeof createLogger>;
export type { FastifyBaseLogger };
