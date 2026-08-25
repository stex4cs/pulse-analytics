/**
 * Pulse Worker (sekcija 2, Faza 1).
 *
 * XREADGROUP (batch 1000 / 5s) -> batch INSERT u ClickHouse -> XACK.
 *
 * Garancije:
 *   - at-least-once: XACK tek posle uspesnog insert-a
 *   - poruke zaostale za srusenim consumer-om se preuzimaju preko XAUTOCLAIM
 *   - ako ClickHouse pukne, poruke ostaju u PEL-u i pokusavaju se ponovo
 *   - spool fajlovi iz ingest-a se preuzimaju periodicno
 */
import {
  config, createLogger, metrics, startMetricsServer,
  createRedis, ensureConsumerGroup, streamDepth, closeRedis,
  chInsert, closeClickHouse,
} from '@pulse/shared';
import { replaySpool } from './spool-reader.js';

const log = createLogger('worker');
const redis = createRedis({ enableOfflineQueue: true });

let running = true;
let inFlight = false;

const STREAM = config.redis.stream;
const GROUP = config.redis.group;
const CONSUMER = config.worker.consumerName;

/** ioredis vraca [[stream, [[id, [field, value, ...]], ...]], ...] */
function parseEntries(entries) {
  const ids = [];
  const rows = [];
  for (const [id, fields] of entries) {
    ids.push(id);
    // Format iz xaddBatch: ['e', '<json>']
    const idx = fields.indexOf('e');
    if (idx === -1) continue;
    try {
      rows.push(JSON.parse(fields[idx + 1]));
    } catch (err) {
      log.warn({ id, err: err.message }, 'neispravan JSON u stream-u, preskacem');
    }
  }
  return { ids, rows };
}

async function flush(ids, rows) {
  if (!rows.length) {
    if (ids.length) await redis.xack(STREAM, GROUP, ...ids);
    return;
  }

  const endTimer = metrics.workerBatchDuration.startTimer();
  try {
    await chInsert('events', rows);
    metrics.workerBatchSize.observe(rows.length);
    metrics.workerEventsWritten.inc(rows.length);
    // XACK tek sada - do ovog trenutka poruke su i dalje nase odgovornosti
    await redis.xack(STREAM, GROUP, ...ids);
    log.debug({ rows: rows.length }, 'batch upisan');
  } catch (err) {
    metrics.clickhouseInsertErrors.inc();
    log.error({ err: err.message, rows: rows.length }, 'insert u ClickHouse pao - poruke ostaju u PEL-u');
    // Kratka pauza da ne zavrtimo petlju u prazno dok se CH oporavlja
    await sleep(2000);
  } finally {
    endTimer();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poruke koje je preuzeo consumer koji je u medjuvremenu pao. */
async function claimStale() {
  try {
    const [, entries] = await redis.xautoclaim(
      STREAM, GROUP, CONSUMER, 60_000, '0', 'COUNT', config.worker.batchSize,
    );
    if (!entries?.length) return 0;
    const { ids, rows } = parseEntries(entries);
    log.warn({ count: ids.length }, 'preuzimam zaostale poruke');
    await flush(ids, rows);
    return ids.length;
  } catch (err) {
    if (!String(err.message).includes('NOGROUP')) {
      log.error({ err: err.message }, 'XAUTOCLAIM pao');
    }
    return 0;
  }
}

async function mainLoop() {
  while (running) {
    try {
      const res = await redis.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', config.worker.batchSize,
        'BLOCK', config.worker.flushMs,
        'STREAMS', STREAM, '>',
      );

      if (!res) continue;   // timeout, nema novih poruka

      inFlight = true;
      for (const [, entries] of res) {
        const { ids, rows } = parseEntries(entries);
        await flush(ids, rows);
      }
      inFlight = false;
    } catch (err) {
      inFlight = false;
      if (String(err.message).includes('NOGROUP')) {
        log.warn('consumer grupa nestala, kreiram ponovo');
        await ensureConsumerGroup(redis);
        continue;
      }
      log.error({ err: err.message }, 'greska u glavnoj petlji');
      await sleep(1000);
    }
  }
}

// ── Periodicni poslovi ──────────────────────────────────────────────────────
const timers = [];

timers.push(setInterval(async () => {
  metrics.queueDepth.set(await streamDepth(redis));
}, 5000));

timers.push(setInterval(() => { claimStale().catch(() => {}); }, 30_000));

timers.push(setInterval(() => {
  replaySpool(log).catch((err) => log.error({ err: err.message }, 'replay spool-a pao'));
}, 60_000));

// ── Start ───────────────────────────────────────────────────────────────────
startMetricsServer(config.worker.metricsPort, log);
await ensureConsumerGroup(redis);
await claimStale();
await replaySpool(log).catch(() => {});

log.info({ consumer: CONSUMER, batch: config.worker.batchSize, flushMs: config.worker.flushMs }, 'worker startovan');

const shutdown = async (signal) => {
  log.info(`${signal} - gasim worker`);
  running = false;
  for (const t of timers) clearInterval(t);
  // Pusti tekuci batch da zavrsi (do 10s) da ne ostane u PEL-u bez potrebe
  for (let i = 0; i < 100 && inFlight; i++) await sleep(100);
  await closeRedis();
  await closeClickHouse();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await mainLoop();
