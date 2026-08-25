/**
 * Pulse Ingestion API (sekcija 4).
 *
 * POST /collect  -> uvek 204, nikad ne blokira klijenta
 * GET  /ab/headline, POST /ab/headlines -> A/B dodela (sekcija 8.1)
 *
 * Cilj: p99 < 20ms, burst 2000 req/s. Zato:
 *   - nema JSON schema validacije po eventu (rucna, jeftina provera)
 *   - UA parsing kesiran po UA stringu
 *   - jedan Redis pipeline po zahtevu (rate brojac + XADD)
 *   - odgovor se salje pre nego sto se ceka Redis (fire-and-forget sa spool fallback-om)
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';

import {
  config, assertProductionSecrets, createLogger, metrics, registry,
  parseUserAgent, viewportBucket, resolveTrafficSource,
  validateRawEvent, buildEventRow,
  createRedis, xaddBatch, streamDepth, closeRedis, closePostgres,
} from '@pulse/shared';

import { initGeo, lookupGeo, hashIp, clientIp } from './geo.js';
import { isRateAbuse, decideBot } from './bot.js';
import { spoolRows, closeSpool } from './spool.js';
import { registerAbRoutes, refreshAbCache, startAbCacheRefresh, stopAbCacheRefresh } from './ab.js';

const log = createLogger('ingest');
assertProductionSecrets();

const redis = createRedis();

const app = Fastify({
  loggerInstance: log,
  bodyLimit: 256 * 1024,
  disableRequestLogging: true,
  trustProxy: true,
  // sendBeacon salje text/plain; moramo ga parsirati kao JSON
  ignoreTrailingSlash: true,
});

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 86400,
});

await app.register(rateLimit, {
  max: config.ingest.rateLimitPerMin,
  timeWindow: '1 minute',
  // Rate limit po IP hash-u: ne drzimo sirovi IP ni u memoriji rate limitera
  keyGenerator: (req) => hashIp(clientIp(req)) || 'anon',
  redis,
  continueExceeding: true,
  skipOnError: true,   // Redis pao != prestani da primas saobracaj
  allowList: (req) => req.url === '/health' || req.url === '/metrics',
  errorResponseBuilder: () => ({ ok: false }),
});

// sendBeacon salje Content-Type: text/plain
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, body ? JSON.parse(body) : {});
  } catch {
    done(null, {});   // nikad ne rusi zahtev zbog losem tela
  }
});

const SITE_SET = new Set(config.sites);

function resolveSite(payload, req) {
  const claimed = String(payload.site ?? '').toLowerCase();
  if (SITE_SET.has(claimed)) return claimed;

  // Izvedi iz Origin/Referer domena: tvarenasport.hr -> hr
  const host = String(req.headers.origin ?? req.headers.referer ?? '');
  const m = host.match(/tvarenasport\.([a-z]{2,3})/i);
  if (m) {
    const tld = m[1].toLowerCase();
    if (tld === 'com') return 'rs';
    if (SITE_SET.has(tld)) return tld;
  }
  return config.defaultSite;
}

// ── POST /collect ───────────────────────────────────────────────────────────
app.post('/collect', async (req, reply) => {
  const endTimer = metrics.ingestLatency.startTimer();

  // Odgovor ide odmah - obrada se zavrsava posle (sekcija 4.1: uvek 204)
  reply.code(204).send();

  try {
    await handleCollect(req);
    metrics.ingestRequests.inc({ status: 'ok' });
  } catch (err) {
    metrics.ingestRequests.inc({ status: 'error' });
    metrics.ingestErrors.inc({ kind: 'handler' });
    log.error({ err: err.message }, 'greska u /collect');
  } finally {
    endTimer();
  }
});

async function handleCollect(req) {
  const payload = req.body ?? {};
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return;

  if (events.length > config.ingest.maxEventsPerRequest) {
    metrics.ingestRejected.inc({ reason: 'batch_too_large' }, events.length - config.ingest.maxEventsPerRequest);
    events.length = config.ingest.maxEventsPerRequest;
  }

  const serverTimeMs = Date.now();
  const ip = clientIp(req);
  const ipHash = hashIp(ip);
  const geo = lookupGeo(ip, req.headers);
  const ua = parseUserAgent(req.headers['user-agent'] ?? '');
  const site = resolveSite(payload, req);

  const url = String(payload.url ?? events[0]?.url ?? '');
  const referrer = String(payload.ref ?? payload.referrer ?? '');
  const source = resolveTrafficSource({
    url,
    referrer,
    utm: payload.utm,
    internalDomains: config.internalDomains,
  });

  const vpBucket = viewportBucket(payload.vw);

  const pageviewCount = events.reduce((n, e) => n + ((e.type ?? e.event_type) === 'pageview' ? 1 : 0), 0);
  const rateAbuse = await isRateAbuse(redis, ipHash, pageviewCount, config.ingest.botPageviewsPerSecond);

  const bot = decideBot({
    uaResult: ua,
    webdriver: payload.wd === 1 || payload.wd === true,
    rateAbuse,
    hasSession: typeof payload.sid === 'string' && payload.sid.length >= 8,
  });

  const rows = [];
  for (const evt of events) {
    // Envelope vrednosti su podrazumevane; event ih moze pregaziti
    const merged = {
      sid: payload.sid,
      vid: payload.vid,
      new: payload.new,
      consent: payload.consent,
      url,
      vw: payload.vw,
      meta: payload.meta,
      ...evt,
    };

    const check = validateRawEvent(merged);
    if (!check.ok) {
      metrics.ingestRejected.inc({ reason: check.reason });
      metrics.ingestEvents.inc({ event_type: String(merged.type ?? 'unknown'), outcome: 'rejected' });
      continue;
    }

    // Event sa sopstvenim URL-om dobija i sopstvenu atribuciju
    const evtSource = merged.url === url
      ? source
      : resolveTrafficSource({ url: merged.url, referrer, internalDomains: config.internalDomains });

    rows.push(buildEventRow(merged, {
      serverTimeMs,
      eventId: crypto.randomUUID(),
      geo,
      ua,
      source: evtSource,
      ipHash,
      isBot: bot.isBot,
      botReason: bot.reason,
      site,
      viewportBucket: merged.vw && merged.vw !== payload.vw ? viewportBucket(merged.vw) : vpBucket,
    }));

    metrics.ingestEvents.inc({ event_type: merged.type, outcome: bot.isBot ? 'bot' : 'accepted' });
  }

  if (!rows.length) return;

  try {
    await xaddBatch(rows, redis);
  } catch (err) {
    // Sekcija 4.3: Redis nedostupan -> lokalni append-only fajl
    metrics.ingestErrors.inc({ kind: 'redis' });
    const spooled = spoolRows(rows);
    if (!spooled) {
      metrics.ingestErrors.inc({ kind: 'spool' });
      log.error({ err: err.message, rows: rows.length }, 'eventi izgubljeni: Redis i spool nedostupni');
    } else {
      log.warn({ rows: rows.length }, 'Redis nedostupan, eventi u spool fajlu');
    }
  }
}

// ── A/B rute ────────────────────────────────────────────────────────────────
registerAbRoutes(app);

// ── Operativne rute ─────────────────────────────────────────────────────────
app.get('/health', async () => ({ status: 'ok', service: 'ingest', ts: new Date().toISOString() }));

app.get('/metrics', async (_req, reply) => {
  metrics.queueDepth.set(await streamDepth(redis));
  reply.header('Content-Type', registry.contentType);
  return registry.metrics();
});

// ── Start ───────────────────────────────────────────────────────────────────
await initGeo(log);
await refreshAbCache(log);
startAbCacheRefresh(log);

const shutdown = async (signal) => {
  log.info(`${signal} - gasim ingest`);
  try {
    stopAbCacheRefresh();
    await app.close();
    closeSpool();
    await closeRedis();
    await closePostgres();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: config.ingest.port, host: '0.0.0.0' });
  log.info(`ingest sluša na :${config.ingest.port}`);
} catch (err) {
  log.error({ err: err.message }, 'ingest nije startovao');
  process.exit(1);
}
