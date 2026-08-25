/**
 * Pulse Dashboard API (sekcija 2 + 11).
 *
 * REST, JWT auth, role-based. Cita PostgreSQL agregate; ClickHouse se dira
 * samo za real-time widget, heatmapu, krivu clanka i GDPR operacije.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import {
  config, assertProductionSecrets, createLogger, metrics, registry,
  closeClickHouse, closePostgres,
} from '@pulse/shared';

import { registerAuthHooks } from './auth.js';
import authRoutes from './routes/auth.js';
import overviewRoutes from './routes/overview.js';
import authorRoutes from './routes/authors.js';
import contentRoutes from './routes/content.js';
import sourceRoutes from './routes/sources.js';
import abRoutes from './routes/ab.js';
import geoRoutes from './routes/geo.js';
import channelRoutes from './routes/channels.js';
import gdprRoutes from './routes/gdpr.js';

const log = createLogger('api');
assertProductionSecrets();

const app = Fastify({
  loggerInstance: log,
  trustProxy: true,
  ignoreTrailingSlash: true,
  bodyLimit: 1024 * 1024,
});

await app.register(cors, {
  origin: config.api.corsOrigin.split(',').map((s) => s.trim()),
  credentials: true,
});

await app.register(jwt, {
  secret: config.api.jwtSecret,
  sign: { expiresIn: config.api.accessTtl },
});

await app.register(rateLimit, {
  max: 600,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.headers.authorization ?? req.ip,
});

registerAuthHooks(app);

// ── Metrika po ruti ─────────────────────────────────────────────────────────
app.addHook('onResponse', async (req, reply) => {
  const route = req.routeOptions?.url ?? 'unknown';
  metrics.apiRequests.inc({ route, status: String(reply.statusCode) });
});

// ── Jedinstvena obrada gresaka ──────────────────────────────────────────────
app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    log.error({ err: err.message, stack: err.stack, url: req.url }, 'greska u API-ju');
    return reply.code(status).send({ error: 'Interna greška' });
  }
  return reply.code(status).send({ error: err.message });
});

// ── Rute ────────────────────────────────────────────────────────────────────
await app.register(authRoutes, { prefix: '/api' });
await app.register(overviewRoutes, { prefix: '/api' });
await app.register(authorRoutes, { prefix: '/api' });
await app.register(contentRoutes, { prefix: '/api' });
await app.register(sourceRoutes, { prefix: '/api' });
await app.register(abRoutes, { prefix: '/api' });
await app.register(geoRoutes, { prefix: '/api' });
await app.register(channelRoutes, { prefix: '/api' });
await app.register(gdprRoutes, { prefix: '/api' });

app.get('/health', async () => ({ status: 'ok', service: 'api', ts: new Date().toISOString() }));

app.get('/metrics', async (_req, reply) => {
  reply.header('Content-Type', registry.contentType);
  return registry.metrics();
});

// ── Start ───────────────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  log.info(`${signal} - gasim API`);
  await app.close();
  await closeClickHouse();
  await closePostgres();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: config.api.port, host: '0.0.0.0' });
  log.info(`dashboard API sluša na :${config.api.port}`);
} catch (err) {
  log.error({ err: err.message }, 'API nije startovao');
  process.exit(1);
}
