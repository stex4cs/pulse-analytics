/**
 * Smoke test iz Faze 1: ručno poslati event -> proveriti da je stigao
 * do ClickHouse-a kroz ceo lanac (ingest -> Redis -> worker -> ClickHouse).
 *
 *   node scripts/smoke-test.mjs
 *   node scripts/smoke-test.mjs --endpoint=http://localhost:8080
 */
import crypto from 'node:crypto';
import { chQuery, closeClickHouse } from '@pulse/shared';

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : fallback;
};

const endpoint = arg('endpoint', 'http://localhost:8080');
const timeoutMs = Number(arg('timeout', 30_000));

const marker = `smoke-${crypto.randomBytes(6).toString('hex')}`;
const sessionId = `s${crypto.randomBytes(12).toString('hex')}`;

const payload = {
  v: 1,
  site: 'rs',
  sid: sessionId,
  vid: `v${crypto.randomBytes(12).toString('hex')}`,
  new: 1,
  consent: 1,
  url: `https://tvarenasport.com/fudbal/superliga-srbije/${marker}?utm_source=newsletter&utm_medium=email&utm_campaign=smoke`,
  ref: 'https://news.google.com/',
  vw: 390,
  vh: 844,
  wd: 0,
  meta: {
    articleId: marker,
    title: 'Smoke test članak',
    author: 'smoke-tester',
    category: 'fudbal/superliga-srbije',
    tags: ['smoke', 'test'],
    publishedAt: new Date().toISOString(),
    contentType: 'news',
    wordCount: 420,
  },
  events: [
    { type: 'pageview', ts: Date.now() },
    { type: 'scroll_depth', ts: Date.now() + 1000, depth: 50 },
    { type: 'time_on_page', ts: Date.now() + 2000, activeMs: 45_000 },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`1/4  Šaljem 3 eventa na ${endpoint}/collect …`);
  const res = await fetch(`${endpoint}/collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    },
    body: JSON.stringify(payload),
  });

  if (res.status !== 204) {
    throw new Error(`/collect je vratio ${res.status}, očekivano 204`);
  }
  console.log('     ✓ 204 No Content');

  console.log('2/4  Čekam da worker upiše batch …');
  const deadline = Date.now() + timeoutMs;
  let rows = [];

  while (Date.now() < deadline) {
    rows = await chQuery(
      `SELECT event_type, traffic_source, channel_detail, device_type, os, country,
              author, category, category_root, tags, has_consent, is_bot,
              scroll_depth, active_time_ms, title
         FROM pulse.events
        WHERE article_id = {marker:String}
        ORDER BY event_type`,
      { marker },
    );
    if (rows.length >= 3) break;
    await sleep(1500);
    process.stdout.write('     .');
  }

  if (rows.length < 3) {
    throw new Error(`U ClickHouse-u je stiglo ${rows.length}/3 eventa u ${timeoutMs / 1000}s`);
  }
  console.log(`\n     ✓ ${rows.length} eventa u pulse.events`);

  console.log('3/4  Proveravam obradu na serveru …');
  const pv = rows.find((r) => r.event_type === 'pageview');
  const checks = [
    // UTM izvor "newsletter" mora da pobedi Discover referrer (korak 2 pre koraka 4)
    ['traffic source (utm_source=newsletter)', pv.traffic_source, 'email'],
    ['device iz UA', pv.device_type, 'mobile'],
    ['OS iz UA', pv.os, 'iOS'],
    ['autor iz pulseMeta', pv.author, 'smoke-tester'],
    ['izvedeni category_root', pv.category_root, 'fudbal'],
    ['consent', String(pv.has_consent), '1'],
    ['bot flag', String(pv.is_bot), '0'],
    ['naslov', pv.title, 'Smoke test članak'],
  ];

  let failed = 0;
  for (const [label, actual, expected] of checks) {
    const ok = String(actual) === String(expected);
    if (!ok) failed++;
    console.log(`     ${ok ? '✓' : '✗'} ${label}: ${actual}${ok ? '' : ` (očekivano ${expected})`}`);
  }

  const scroll = rows.find((r) => r.event_type === 'scroll_depth');
  const time = rows.find((r) => r.event_type === 'time_on_page');
  console.log(`     ${scroll?.scroll_depth === 50 ? '✓' : '✗'} scroll_depth: ${scroll?.scroll_depth}`);
  console.log(`     ${time?.active_time_ms === 45000 ? '✓' : '✗'} active_time_ms: ${time?.active_time_ms}`);

  console.log('4/4  Proveravam materialized views …');
  const [mv] = await chQuery(
    `SELECT sum(pageviews) AS pv FROM pulse.article_hourly WHERE article_id = {marker:String}`,
    { marker },
  );
  const mvOk = Number(mv?.pv) >= 1;
  console.log(`     ${mvOk ? '✓' : '✗'} article_hourly: ${mv?.pv ?? 0} pregleda`);
  if (!mvOk) failed++;

  const [tagMv] = await chQuery(
    `SELECT sum(pageviews) AS pv FROM pulse.tag_daily WHERE tag = 'smoke'`,
  );
  console.log(`     ${Number(tagMv?.pv) >= 1 ? '✓' : '✗'} tag_daily: ${tagMv?.pv ?? 0} pregleda`);

  if (failed > 0) throw new Error(`${failed} provera nije prošlo`);

  console.log('\nSmoke test prošao — ceo lanac radi.');
  console.log(`Test podaci se čiste sa:\n  ALTER TABLE pulse.events DELETE WHERE article_id = '${marker}'`);
}

try {
  await run();
} catch (err) {
  console.error(`\nSmoke test PAO: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closeClickHouse();
}
