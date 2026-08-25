/**
 * Rucno pokretanje pojedinacnog posla - za backfill i debug.
 *
 *   node src/cli.js daily 2026-08-01 2026-08-24
 *   node src/cli.js articles 30
 *   node src/cli.js rollup week 2026-07-01 2026-08-24
 *   node src/cli.js trending | spike | ab | hourly
 */
import { closeClickHouse, closePostgres } from '@pulse/shared';
import { aggregateDailyRange, aggregateHourlyTraffic } from './jobs/aggregate.js';
import { aggregateArticles } from './jobs/articles.js';
import { computeTagTrending } from './jobs/trending.js';
import { detectSpikes } from './jobs/spike.js';
import { updateAbResults } from './jobs/ab.js';
import { rollupAll } from './jobs/rollup.js';
import { sendScheduledReports } from './jobs/reports.js';

const [, , command, ...args] = process.argv;

const commands = {
  daily: () => aggregateDailyRange(args[0], args[1] ?? args[0]),
  articles: () => aggregateArticles(Number(args[0]) || 30),
  hourly: () => aggregateHourlyTraffic(Number(args[0]) || 200),
  trending: () => computeTagTrending(),
  spike: () => detectSpikes(),
  ab: () => updateAbResults(),
  rollup: () => rollupAll(args[0] ?? 'week', args[1], args[2] ?? args[1]),
  reports: () => sendScheduledReports(args[0] ?? 'weekly'),
};

const fn = commands[command];
if (!fn) {
  console.error(`Nepoznata komanda "${command}". Dostupno: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

try {
  const result = await fn();
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Posao pao:', err.message);
  process.exitCode = 1;
} finally {
  await closeClickHouse();
  await closePostgres();
}
