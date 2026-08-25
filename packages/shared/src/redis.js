import Redis from 'ioredis';
import { config } from './config.js';

const clients = new Set();

export function createRedis(options = {}) {
  const client = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false, // brzo pucaj pa idi u spool fajl (sekcija 4.3)
    connectTimeout: 3000,
    lazyConnect: false,
    ...options,
  });
  client.on('error', (err) => {
    if (!client.__loggedError || Date.now() - client.__loggedError > 10_000) {
      client.__loggedError = Date.now();
      console.error('[redis]', err.message);
    }
  });
  clients.add(client);
  return client;
}

let shared = null;
export function getRedis() {
  if (!shared) shared = createRedis();
  return shared;
}

/**
 * Ubacuje evente u stream jednim pipeline-om.
 * MAXLEN ~ ogranicava rast ako worker zaostane (sekcija 15.2).
 */
export async function xaddBatch(rows, redis = getRedis()) {
  if (!rows.length) return 0;
  const pipe = redis.pipeline();
  for (const row of rows) {
    pipe.xadd(
      config.redis.stream,
      'MAXLEN', '~', String(config.redis.maxlen),
      '*',
      'e', JSON.stringify(row),
    );
  }
  const results = await pipe.exec();
  const failed = results.filter(([err]) => err);
  if (failed.length) throw failed[0][0];
  return rows.length;
}

export async function ensureConsumerGroup(redis = getRedis()) {
  try {
    await redis.xgroup('CREATE', config.redis.stream, config.redis.group, '0', 'MKSTREAM');
  } catch (err) {
    if (!String(err.message).includes('BUSYGROUP')) throw err;
  }
}

export async function streamDepth(redis = getRedis()) {
  try {
    const info = await redis.xinfo('GROUPS', config.redis.stream);
    // ioredis vraca niz nizova [ime, vrednost, ...]
    let lag = 0;
    for (const group of info) {
      const obj = {};
      for (let i = 0; i < group.length; i += 2) obj[group[i]] = group[i + 1];
      if (obj.name === config.redis.group) lag = Number(obj.pending ?? 0) + Number(obj.lag ?? 0);
    }
    return lag;
  } catch {
    return 0;
  }
}

export async function closeRedis() {
  for (const c of clients) {
    try { await c.quit(); } catch { c.disconnect(); }
  }
  clients.clear();
  shared = null;
}
