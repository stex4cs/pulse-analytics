/**
 * Prometheus metrike (sekcija 13.4).
 * Sve metrike koje spec zahteva definisane su ovde na jednom mestu.
 */
import client from 'prom-client';
import http from 'node:http';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'pulse_' });

export const ingestRequests = new client.Counter({
  name: 'pulse_ingest_requests_total',
  help: 'Ukupno /collect zahteva',
  labelNames: ['status'],
  registers: [registry],
});

export const ingestEvents = new client.Counter({
  name: 'pulse_ingest_events_total',
  help: 'Ukupno primljenih eventa',
  labelNames: ['event_type', 'outcome'],
  registers: [registry],
});

export const ingestErrors = new client.Counter({
  name: 'pulse_ingest_errors_total',
  help: 'Greske na ingestion-u',
  labelNames: ['kind'],
  registers: [registry],
});

export const ingestLatency = new client.Histogram({
  name: 'pulse_ingest_duration_seconds',
  help: 'Trajanje obrade /collect zahteva',
  buckets: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const ingestRejected = new client.Counter({
  name: 'pulse_ingest_rejected_events_total',
  help: 'Odbaceni malformirani eventi',
  labelNames: ['reason'],
  registers: [registry],
});

export const spoolWrites = new client.Counter({
  name: 'pulse_ingest_spool_writes_total',
  help: 'Eventi upisani u lokalni spool jer Redis nije bio dostupan',
  registers: [registry],
});

export const queueDepth = new client.Gauge({
  name: 'pulse_queue_depth',
  help: 'Broj neobradjenih poruka u Redis Stream-u (alert > 50000)',
  registers: [registry],
});

export const workerBatchDuration = new client.Histogram({
  name: 'pulse_worker_batch_duration_seconds',
  help: 'Trajanje batch insert-a u ClickHouse',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const workerBatchSize = new client.Histogram({
  name: 'pulse_worker_batch_size',
  help: 'Broj redova po batch-u',
  buckets: [1, 10, 50, 100, 250, 500, 1000, 2000, 5000],
  registers: [registry],
});

export const clickhouseInsertErrors = new client.Counter({
  name: 'pulse_clickhouse_insert_errors_total',
  help: 'Neuspeli insert-i u ClickHouse',
  registers: [registry],
});

export const workerEventsWritten = new client.Counter({
  name: 'pulse_worker_events_written_total',
  help: 'Eventi upisani u ClickHouse',
  registers: [registry],
});

export const cronLastSuccess = new client.Gauge({
  name: 'pulse_cron_last_success_timestamp',
  help: 'Unix vreme poslednje uspesne agregacije (alert ako > 15 min)',
  labelNames: ['job'],
  registers: [registry],
});

export const cronDuration = new client.Histogram({
  name: 'pulse_cron_duration_seconds',
  help: 'Trajanje cron posla',
  labelNames: ['job'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

export const cronErrors = new client.Counter({
  name: 'pulse_cron_errors_total',
  help: 'Greske u cron poslovima',
  labelNames: ['job'],
  registers: [registry],
});

export const spikeAlerts = new client.Counter({
  name: 'pulse_spike_alerts_total',
  help: 'Detektovani spike-ovi',
  labelNames: ['site'],
  registers: [registry],
});

export const apiRequests = new client.Counter({
  name: 'pulse_api_requests_total',
  help: 'Zahtevi ka dashboard API-ju',
  labelNames: ['route', 'status'],
  registers: [registry],
});

/** Samostalni /metrics server za servise bez HTTP-a (worker, cron). */
export function startMetricsServer(port, log = console) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
      return;
    }
    if (req.url === '/health') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(port, () => log.info?.(`metrics na :${port}/metrics`));
  return server;
}

export { client as promClient };
