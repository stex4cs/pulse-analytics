/**
 * Load test za /collect (Faza 6): simulira burst od 2000 req/s.
 *
 *   k6 run loadtest/k6-collect.js
 *   k6 run -e ENDPOINT=https://pulse.tvarenasport.com loadtest/k6-collect.js
 *
 * Profil prati stvarnost sa derbija: mirno stanje, pa nagli skok kad padne gol.
 */
import http from 'k6/http';
import { check } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const ENDPOINT = __ENV.ENDPOINT || 'http://localhost:8080';

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 300,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 200,
      maxVUs: 800,
    },
    derby_spike: {
      executor: 'ramping-arrival-rate',
      startTime: '2m',
      startRate: 300,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 3000,
      stages: [
        { target: 500, duration: '30s' },
        { target: 2000, duration: '20s' },   // gol
        { target: 2000, duration: '60s' },
        { target: 400, duration: '60s' },
      ],
    },
  },
  thresholds: {
    // Sekcija 4.3: p99 < 20ms na aplikaciji. Preko mreze dodajemo rezervu.
    'http_req_duration{scenario:steady}': ['p(99)<50'],
    'http_req_duration{scenario:derby_spike}': ['p(99)<200'],
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
  },
};

const CATEGORIES = [
  'fudbal/superliga-srbije', 'fudbal/liga-sampiona', 'kosarka/nba',
  'kosarka/evroliga', 'tenis/atp',
];
const AUTHORS = ['milan-nastic', 'jelena-popovic', 'stefan-ilic', 'ana-markovic'];
const REFERRERS = [
  'https://www.google.com/', 'https://news.google.com/', 'https://www.facebook.com/',
  '', 'https://t.co/abc', 'https://www.instagram.com/',
];
const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
];

const pick = (arr) => arr[randomIntBetween(0, arr.length - 1)];

export default function () {
  const articleId = String(randomIntBetween(70000, 79999));
  const category = pick(CATEGORIES);
  const sessionId = `s${__VU}-${__ITER}-${randomIntBetween(1000, 999999)}`;
  const now = Date.now();

  const payload = {
    v: 1,
    site: 'rs',
    sid: sessionId,
    vid: `v${__VU}-${randomIntBetween(1, 50000)}`,
    new: 0,
    consent: 1,
    url: `https://tvarenasport.com/${category}/${articleId}`,
    ref: pick(REFERRERS),
    vw: 390,
    vh: 844,
    wd: 0,
    meta: {
      articleId,
      title: `Load test ${articleId}`,
      author: pick(AUTHORS),
      category,
      tags: ['load-test', category.split('/')[1]],
      publishedAt: new Date(now - randomIntBetween(0, 86400000)).toISOString(),
      contentType: 'news',
      wordCount: randomIntBetween(200, 900),
    },
    // Realan batch: pageview + par pratecih eventa
    events: [
      { type: 'pageview', ts: now },
      { type: 'scroll_depth', ts: now + 2000, depth: pick([25, 50, 75, 100]) },
      { type: 'time_on_page', ts: now + 30000, activeMs: randomIntBetween(5000, 180000) },
    ],
  };

  const res = http.post(`${ENDPOINT}/collect`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'User-Agent': pick(UAS) },
    tags: { name: 'collect' },
  });

  check(res, {
    'status 204': (r) => r.status === 204,
  });
}

export function handleSummary(data) {
  const p99 = data.metrics.http_req_duration?.values['p(99)'] ?? 0;
  const rps = data.metrics.http_reqs?.values.rate ?? 0;
  const failed = data.metrics.http_req_failed?.values.rate ?? 0;

  const summary = [
    '',
    '─── Pulse load test ────────────────────────────',
    `  Zahteva/s (prosek) : ${rps.toFixed(0)}`,
    `  p99 latencija      : ${p99.toFixed(1)} ms`,
    `  Neuspelih          : ${(failed * 100).toFixed(3)} %`,
    '',
    '  Posle testa proveriti:',
    '    pulse_queue_depth  (ne sme da ostane visok)',
    '    pulse_worker_batch_duration_seconds',
    '    count() u pulse.events za tag load-test',
    '────────────────────────────────────────────────',
    '',
  ].join('\n');

  return { stdout: summary };
}
