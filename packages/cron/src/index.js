/**
 * Pulse cron servis (sekcija 7 + 14, Faza 3).
 *
 * Raspored:
 *   svakih 5 min   hot       - danasnji dan: agregati, clanci, A/B
 *   svakih 10 min  trending  - trending score za tagove
 *   svakog minuta  spike     - live-match spike detekcija
 *   02:15          nightly   - ponovni obracun juce + backfill + rollup-ovi
 *   pon 06:00      weekly    - nedeljni email izvestaji
 *   1. u mesecu    monthly   - mesecni email izvestaji
 */
import { Cron } from 'croner';
import {
  config, createLogger, startMetricsServer,
  closeClickHouse, closePostgres,
} from '@pulse/shared';

import { runJob, getWatermark, setWatermark } from './runner.js';
import { aggregateDailyRange, aggregateHourlyTraffic } from './jobs/aggregate.js';
import { aggregateArticles } from './jobs/articles.js';
import { computeTagTrending } from './jobs/trending.js';
import { detectSpikes } from './jobs/spike.js';
import { updateAbResults } from './jobs/ab.js';
import { rollupAll } from './jobs/rollup.js';
import { sendScheduledReports } from './jobs/reports.js';

const log = createLogger('cron');

const utcDate = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// ── Hot: danasnji dan, svakih 5 minuta ─────────────────────────────────────
async function hotJob() {
  const today = utcDate(0);
  // Ukljucujemo i juce: eventi koji stignu posle ponoci (spool, retry) menjaju
  // jucerasnje brojeve, a niko nece cekati nocni prolaz da ih vidi.
  const yesterday = utcDate(-1);

  const articles = await aggregateArticles(2);
  const daily = await aggregateDailyRange(yesterday, today);
  const hourly = await aggregateHourlyTraffic(200);
  const ab = await updateAbResults();

  await setWatermark('hot', new Date());
  return { rows: articles + daily.rows + hourly + ab, articles, hourly, ab, ...daily };
}

// ── Nocni: ponovni obracun + backfill + rollup ─────────────────────────────
async function nightlyJob() {
  // Backfill: od poslednjeg uspesnog vodoziga do juce (sekcija 14, Faza 3)
  const watermark = await getWatermark('nightly', 3);
  const from = watermark.toISOString().slice(0, 10);
  const to = utcDate(-1);

  log.info({ from, to }, 'nocni prolaz + backfill');

  const daily = await aggregateDailyRange(from, to);
  const articles = await aggregateArticles(30);

  // Rollup-ovi: tekuca i prethodna nedelja, tekuci i prethodni mesec
  const weekFrom = utcDate(-21);
  const monthFrom = utcDate(-62);
  const week = await rollupAll('week', weekFrom, to);
  const month = await rollupAll('month', monthFrom, to);

  await setWatermark('nightly', new Date(`${to}T00:00:00Z`));

  const rows = daily.rows + articles
    + Object.values(week).reduce((a, b) => a + b, 0)
    + Object.values(month).reduce((a, b) => a + b, 0);

  return { rows, from, to, daily, articles, week, month };
}

// ── Raspored ───────────────────────────────────────────────────────────────
const jobs = [];

jobs.push(new Cron(config.cron.hot, { name: 'hot', timezone: 'UTC', protect: true }, () => {
  runJob('hot', hotJob);
}));

jobs.push(new Cron(config.cron.trending, { name: 'trending', timezone: 'UTC', protect: true }, () => {
  runJob('trending', async () => ({ rows: await computeTagTrending() }));
}));

jobs.push(new Cron(config.cron.spike, { name: 'spike', timezone: 'UTC', protect: true }, () => {
  runJob('spike', async () => ({ rows: await detectSpikes() }));
}));

jobs.push(new Cron(config.cron.nightly, { name: 'nightly', timezone: 'UTC', protect: true }, () => {
  runJob('nightly', nightlyJob);
}));

jobs.push(new Cron('0 6 * * 1', { name: 'weekly-reports', timezone: config.displayTimezone, protect: true }, () => {
  runJob('weekly-reports', async () => ({ rows: await sendScheduledReports('weekly') }));
}));

jobs.push(new Cron('30 6 1 * *', { name: 'monthly-reports', timezone: config.displayTimezone, protect: true }, () => {
  runJob('monthly-reports', async () => ({ rows: await sendScheduledReports('monthly') }));
}));

startMetricsServer(config.cron.metricsPort, log);

log.info({
  hot: config.cron.hot,
  trending: config.cron.trending,
  spike: config.cron.spike,
  nightly: config.cron.nightly,
}, 'cron servis startovan');

// Prvi prolaz odmah po startu da dashboard ne bude prazan
runJob('hot', hotJob);

const shutdown = async (signal) => {
  log.info(`${signal} - gasim cron`);
  for (const job of jobs) job.stop();
  await closeClickHouse();
  await closePostgres();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
