/**
 * Centralna konfiguracija. Svi servisi citaju odavde - nema process.env
 * raspredenog po kodu.
 */

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const list = (v, d = []) =>
  (v ?? '').split(',').map((s) => s.trim()).filter(Boolean).length
    ? v.split(',').map((s) => s.trim()).filter(Boolean)
    : d;

export const config = {
  env: process.env.NODE_ENV ?? 'development',

  sites: list(process.env.PULSE_SITES, ['rs', 'hr', 'ba', 'si']),
  defaultSite: process.env.PULSE_DEFAULT_SITE ?? 'rs',
  /**
   * Grupisanje teritorija na ingestion-u: MaxMind vraca XK za Kosovo, a za
   * ovog klijenta je to deo Srbije. Isto grupisanje je primenjeno i na mapi
   * (scripts/build-world-map.mjs) - da tabela i mapa ne pokazuju razlicito.
   * Format: "XK:RS,AAA:BBB". Prazna vrednost iskljucuje grupisanje.
   */
  countryMerge: Object.fromEntries(
    list(process.env.PULSE_COUNTRY_MERGE, ['XK:RS'])
      .map((pair) => pair.split(':').map((x) => x.trim().toUpperCase()))
      .filter(([from, to]) => from && to),
  ),

  internalDomains: list(process.env.PULSE_INTERNAL_DOMAINS, [
    'tvarenasport.com',
    'tvarenasport.hr',
    'tvarenasport.ba',
    'tvarenasport.si',
  ]),

  clickhouse: {
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    database: process.env.CLICKHOUSE_DB ?? 'pulse',
    username: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    stream: process.env.PULSE_STREAM ?? 'pulse:events',
    group: process.env.PULSE_CONSUMER_GROUP ?? 'pulse-workers',
    maxlen: int(process.env.PULSE_STREAM_MAXLEN, 2_000_000),
  },

  postgres: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: int(process.env.POSTGRES_PORT, 5432),
    database: process.env.POSTGRES_DB ?? 'pulse',
    user: process.env.POSTGRES_USER ?? 'pulse',
    password: process.env.POSTGRES_PASSWORD ?? 'pulse',
    max: int(process.env.POSTGRES_POOL_MAX, 10),
  },

  ingest: {
    port: int(process.env.INGEST_PORT, 8080),
    rateLimitPerMin: int(process.env.INGEST_RATE_LIMIT_PER_MIN, 100),
    maxEventsPerRequest: int(process.env.INGEST_MAX_EVENTS_PER_REQUEST, 50),
    spoolDir: process.env.INGEST_SPOOL_DIR ?? './spool',
    geoipDb: process.env.GEOIP_CITY_DB ?? '',
    ipHashSecret: process.env.IP_HASH_SECRET ?? 'dev-insecure-secret',
    // >10 pageview/s sa istog IP hash-a -> bot (sekcija 3.3)
    botPageviewsPerSecond: int(process.env.BOT_PV_PER_SEC, 10),
  },

  worker: {
    batchSize: int(process.env.WORKER_BATCH_SIZE, 1000),
    flushMs: int(process.env.WORKER_FLUSH_MS, 5000),
    consumerName: process.env.WORKER_CONSUMER_NAME ?? 'worker-1',
    metricsPort: int(process.env.WORKER_METRICS_PORT, 9101),
    spoolDir: process.env.INGEST_SPOOL_DIR ?? './spool',
  },

  cron: {
    hot: process.env.CRON_HOT_INTERVAL ?? '*/5 * * * *',
    nightly: process.env.CRON_NIGHTLY ?? '15 2 * * *',
    trending: process.env.CRON_TRENDING ?? '*/10 * * * *',
    spike: process.env.CRON_SPIKE ?? '* * * * *',
    metricsPort: int(process.env.CRON_METRICS_PORT, 9102),
    spikeMultiplier: Number(process.env.SPIKE_MULTIPLIER ?? 3),
    spikeMinPageviews: int(process.env.SPIKE_MIN_PAGEVIEWS_PER_MIN, 50),
    spikeCooldownMin: int(process.env.SPIKE_COOLDOWN_MIN, 20),
    slackWebhook: process.env.SLACK_WEBHOOK_URL ?? '',
  },

  api: {
    port: int(process.env.API_PORT, 8081),
    jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-jwt-secret-change-me!!',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '8h',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    corsOrigin: process.env.API_CORS_ORIGIN ?? 'http://localhost:3000',
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.REPORT_FROM ?? 'pulse@tvarenasport.com',
  },

  // Prikaz je Europe/Belgrade, skladiste je UTC (sekcija 15.4)
  displayTimezone: 'Europe/Belgrade',
};

export function assertProductionSecrets() {
  if (config.env !== 'production') return;
  const weak = [];
  if (config.api.jwtSecret.length < 32 || config.api.jwtSecret.startsWith('dev-')) weak.push('JWT_SECRET');
  if (config.ingest.ipHashSecret.startsWith('dev-')) weak.push('IP_HASH_SECRET');
  if (weak.length) {
    throw new Error(`Nebezbedne vrednosti u produkciji: ${weak.join(', ')}`);
  }
}
