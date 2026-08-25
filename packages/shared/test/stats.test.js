import test from 'node:test';
import assert from 'node:assert/strict';
import {
  twoProportionZTest, evaluateAbTest, trendingScore, isRealRead, normalCdf, percentileOf,
} from '../src/stats.js';
import { parseUserAgent, viewportBucket } from '../src/ua.js';
import { validateRawEvent, buildEventRow } from '../src/schema.js';

// ── z-test ──────────────────────────────────────────────────────────────────
test('normalCdf pogadja poznate vrednosti', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
});

test('jasna razlika u CTR-u daje visoku konfidenciju', () => {
  const r = twoProportionZTest(200, 10000, 400, 10000);
  assert.ok(r.confidence > 0.99, `konfidencija ${r.confidence}`);
  assert.ok(r.lift > 0.9);
});

test('identicne varijante nemaju znacajnost', () => {
  const r = twoProportionZTest(300, 10000, 300, 10000);
  assert.ok(r.confidence < 0.05);
});

test('prazan uzorak ne puca', () => {
  const r = twoProportionZTest(0, 0, 0, 0);
  assert.equal(r.confidence, 0);
});

// ── A/B evaluacija (sekcija 8.2) ────────────────────────────────────────────
test('ispod 1000 impresija nema pobednika, ma koliko razlika bila velika', () => {
  const res = evaluateAbTest([
    { variant: 'A', impressions: 400, clicks: 20, is_control: true },
    { variant: 'B', impressions: 400, clicks: 90 },
  ]);
  assert.equal(res.winner, null);
  assert.equal(res.hasEnoughData, false);
  assert.equal(res.reason, 'insufficient_sample');
  assert.equal(res.impressionsNeeded, 600);
});

test('dovoljno uzorka + 95%+ konfidencija -> pobednik', () => {
  const res = evaluateAbTest([
    { variant: 'A', impressions: 20000, clicks: 600, is_control: true },
    { variant: 'B', impressions: 20000, clicks: 900 },
  ]);
  assert.equal(res.hasEnoughData, true);
  assert.equal(res.winner, 'B');
});

test('dovoljno uzorka ali bez znacajnosti -> nema pobednika', () => {
  const res = evaluateAbTest([
    { variant: 'A', impressions: 5000, clicks: 250, is_control: true },
    { variant: 'B', impressions: 5000, clicks: 258 },
  ]);
  assert.equal(res.winner, null);
  assert.equal(res.reason, 'not_significant');
});

test('jedna varijanta nije test', () => {
  const res = evaluateAbTest([{ variant: 'A', impressions: 9999, clicks: 100 }]);
  assert.equal(res.winner, null);
  assert.equal(res.reason, 'need_two_variants');
});

// ── Trending (sekcija 9.3) ──────────────────────────────────────────────────
test('log faktor sprecava da mali clanak nadmasi veliki', () => {
  const mali = trendingScore(20, 5);      // 4x skok, ali 20 pregleda
  const veliki = trendingScore(12000, 5000); // 2.4x skok, 12000 pregleda
  assert.ok(veliki > mali, `veliki=${veliki} mali=${mali}`);
});

test('nula pregleda -> nula skora', () => {
  assert.equal(trendingScore(0, 100), 0);
});

test('bez istorije skor je konacan', () => {
  assert.ok(Number.isFinite(trendingScore(500, 0)));
});

// ── Read completion (sekcija 9.2) ───────────────────────────────────────────
test('scroll 100% ali prekratko vreme nije procitano', () => {
  // 400 reci -> potrebno 120s
  assert.equal(isRealRead({ scrollDepth: 100, activeTimeMs: 20_000, wordCount: 400 }), false);
});

test('scroll 75%+ i dovoljno vremena jeste procitano', () => {
  assert.equal(isRealRead({ scrollDepth: 75, activeTimeMs: 130_000, wordCount: 400 }), true);
});

test('plitak scroll nikad nije procitano', () => {
  assert.equal(isRealRead({ scrollDepth: 50, activeTimeMs: 999_000, wordCount: 400 }), false);
});

test('percentileOf', () => {
  const sorted = [10, 20, 30, 40, 50];
  assert.equal(percentileOf(30, sorted), 60);
  assert.equal(percentileOf(5, sorted), 0);
  assert.equal(percentileOf(99, sorted), 100);
});

// ── UA parsing / bot filter (sekcija 3.3) ───────────────────────────────────
test('Googlebot je bot', () => {
  const r = parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  assert.equal(r.is_bot, true);
  assert.equal(r.bot_reason, 'ua_blacklist');
});

test('HeadlessChrome je bot sa razlogom headless', () => {
  const r = parseUserAgent('Mozilla/5.0 HeadlessChrome/120.0.0.0');
  assert.equal(r.is_bot, true);
  assert.equal(r.bot_reason, 'headless');
});

test('prazan UA je bot', () => {
  assert.equal(parseUserAgent('').is_bot, true);
});

test('iPhone Safari -> mobile', () => {
  const r = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  assert.equal(r.device_type, 'mobile');
  assert.equal(r.os, 'iOS');
  assert.ok(r.browser.startsWith('Safari'));
  assert.equal(r.is_bot, false);
});

test('Windows Chrome -> desktop', () => {
  const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  assert.equal(r.device_type, 'desktop');
  assert.equal(r.os, 'Windows 10/11');
  assert.equal(r.browser, 'Chrome 126');
});

test('iPad -> tablet', () => {
  const r = parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1');
  assert.equal(r.device_type, 'tablet');
});

test('viewportBucket normalizuje sirine (sekcija 9.1)', () => {
  assert.equal(viewportBucket(390), 375);
  assert.equal(viewportBucket(1366), 1024);
  assert.equal(viewportBucket(1920), 1920);
  assert.equal(viewportBucket(2560), 1920);
  assert.equal(viewportBucket(300), 320);
  assert.equal(viewportBucket(0), 0);
});

// ── Validacija eventa ───────────────────────────────────────────────────────
const validEvent = {
  type: 'pageview',
  sid: 'sess-abcdefgh',
  url: 'https://tvarenasport.com/fudbal/76177',
  ts: Date.now(),
};

test('ispravan pageview prolazi validaciju', () => {
  assert.equal(validateRawEvent(validEvent).ok, true);
});

test('nepoznat tip eventa se odbacuje', () => {
  const r = validateRawEvent({ ...validEvent, type: 'hakovanje' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown_event_type');
});

test('scroll_depth van {25,50,75,100} se odbacuje', () => {
  assert.equal(validateRawEvent({ ...validEvent, type: 'scroll_depth', depth: 33 }).ok, false);
});

test('bez session_id se odbacuje', () => {
  assert.equal(validateRawEvent({ ...validEvent, sid: 'x' }).ok, false);
});

test('bez consent-a se ne cuva visitor_id ni klik koordinate (sekcija 12.1)', () => {
  const ctx = {
    serverTimeMs: Date.now(), eventId: 'e1', geo: { country: 'RS', city: 'Beograd' },
    ua: { device_type: 'mobile', browser: 'Chrome 126', os: 'Android' },
    source: { traffic_source: 'direct', channel_detail: '', referrer_domain: '', utm_source: '', utm_medium: '', utm_campaign: '' },
    ipHash: 'abc', isBot: false, botReason: '', site: 'rs', viewportBucket: 375,
  };
  const row = buildEventRow({ ...validEvent, type: 'click', vid: 'visitor-123', x: 100, y: 200, selector: '.cta', consent: false }, ctx);
  assert.equal(row.visitor_id, '');
  assert.equal(row.click_x, 0);
  assert.equal(row.click_selector, '');
  assert.equal(row.has_consent, 0);
});

test('uz consent se cuvaju visitor_id i koordinate', () => {
  const ctx = {
    serverTimeMs: Date.now(), eventId: 'e1', geo: { country: 'RS', city: 'Beograd' },
    ua: { device_type: 'mobile', browser: 'Chrome 126', os: 'Android' },
    source: { traffic_source: 'direct', channel_detail: '', referrer_domain: '', utm_source: '', utm_medium: '', utm_campaign: '' },
    ipHash: 'abc', isBot: false, botReason: '', site: 'rs', viewportBucket: 375,
  };
  const row = buildEventRow({ ...validEvent, type: 'click', vid: 'visitor-123', x: 100, y: 200, selector: '.cta', consent: true }, ctx);
  assert.equal(row.visitor_id, 'visitor-123');
  assert.equal(row.click_x, 100);
});

test('server timestamp je autoritativan, klijentski se cuva za clock skew', () => {
  const serverTimeMs = Date.UTC(2026, 7, 24, 12, 0, 0);
  const clientTs = serverTimeMs + 45_000;
  const ctx = {
    serverTimeMs, eventId: 'e1', geo: { country: 'RS', city: '' },
    ua: { device_type: 'desktop', browser: 'Chrome 126', os: 'Windows 10/11' },
    source: { traffic_source: 'direct', channel_detail: '', referrer_domain: '', utm_source: '', utm_medium: '', utm_campaign: '' },
    ipHash: 'abc', isBot: false, botReason: '', site: 'rs', viewportBucket: 1920,
  };
  const row = buildEventRow({ ...validEvent, ts: clientTs }, ctx);
  assert.equal(row.timestamp, '2026-08-24 12:00:00.000');
  assert.equal(row.clock_skew_ms, 45_000);
});
