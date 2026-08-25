/**
 * Unit testovi za traffic source resolution - jedan test za svaki slucaj
 * iz sekcije 5.1 (zahtev iz Faze 3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrafficSource, extractDomain, parseUrlParams, SOURCES } from '../src/traffic-source.js';

const INTERNAL = ['tvarenasport.com', 'tvarenasport.hr', 'tvarenasport.ba', 'tvarenasport.si'];
const resolve = (url, referrer) => resolveTrafficSource({ url, referrer, internalDomains: INTERNAL });

// ── Korak 1: paid medium ────────────────────────────────────────────────────
test('korak 1: utm_medium=cpc -> paid, channel_detail = utm_source', () => {
  const r = resolve('https://tvarenasport.com/a?utm_source=google&utm_medium=cpc&utm_campaign=derbi', '');
  assert.equal(r.traffic_source, SOURCES.PAID);
  assert.equal(r.channel_detail, 'google');
});

for (const medium of ['ppc', 'paid', 'paidsocial', 'display', 'banner']) {
  test(`korak 1: utm_medium=${medium} -> paid`, () => {
    const r = resolve(`https://tvarenasport.com/a?utm_source=meta&utm_medium=${medium}`, '');
    assert.equal(r.traffic_source, SOURCES.PAID);
  });
}

test('korak 1 ima prednost nad referrer-om', () => {
  const r = resolve('https://tvarenasport.com/a?utm_source=fb&utm_medium=cpc', 'https://www.google.com/');
  assert.equal(r.traffic_source, SOURCES.PAID);
});

// ── Korak 2: utm_source bez paid medium-a ───────────────────────────────────
test('korak 2: utm_source=facebook -> social_meta, channel_detail = utm_campaign', () => {
  const r = resolve('https://tvarenasport.com/a?utm_source=facebook&utm_medium=social&utm_campaign=veciti-derbi', '');
  assert.equal(r.traffic_source, SOURCES.SOCIAL_META);
  assert.equal(r.channel_detail, 'veciti-derbi');
});

test('korak 2: nepoznat utm_source -> referral', () => {
  const r = resolve('https://tvarenasport.com/a?utm_source=partner-portal&utm_campaign=x', '');
  assert.equal(r.traffic_source, SOURCES.REFERRAL);
});

test('korak 2: newsletter dobija svoj kanal, ne lazni direct (sekcija 5.2)', () => {
  const r = resolve('https://tvarenasport.com/a?utm_source=newsletter&utm_medium=email', '');
  assert.equal(r.traffic_source, SOURCES.EMAIL);
});

test('korak 2 ima prednost nad gclid-om (redosled iz spec-a)', () => {
  const r = resolve('https://tvarenasport.com/a?utm_source=youtube&gclid=abc123', '');
  assert.equal(r.traffic_source, SOURCES.SOCIAL_YOUTUBE);
});

// ── Korak 3: klik ID-jevi ───────────────────────────────────────────────────
test('korak 3: gclid bez UTM-a -> paid / google_ads', () => {
  const r = resolve('https://tvarenasport.com/a?gclid=EAIaIQobCh', '');
  assert.equal(r.traffic_source, SOURCES.PAID);
  assert.equal(r.channel_detail, 'google_ads');
});

test('korak 3: fbclid bez UTM-a -> paid / meta_ads', () => {
  const r = resolve('https://tvarenasport.com/a?fbclid=IwAR0x', '');
  assert.equal(r.traffic_source, SOURCES.PAID);
  assert.equal(r.channel_detail, 'meta_ads');
});

// ── Korak 4: referrer matching ──────────────────────────────────────────────
const referrerCases = [
  ['https://www.google.com/',                        SOURCES.SEARCH_ORGANIC],
  ['https://www.google.rs/search?q=partizan',        SOURCES.SEARCH_ORGANIC],
  ['https://www.google.co.uk/',                      SOURCES.SEARCH_ORGANIC],
  ['https://www.bing.com/search?q=x',                SOURCES.SEARCH_ORGANIC],
  ['https://duckduckgo.com/',                        SOURCES.SEARCH_ORGANIC],
  ['https://yandex.ru/search/',                      SOURCES.SEARCH_ORGANIC],
  ['https://news.google.com/',                       SOURCES.GOOGLE_DISCOVER],
  ['https://www.googleapis.com/',                    SOURCES.GOOGLE_DISCOVER],
  ['android-app://com.google.android.googlequicksearchbox/', SOURCES.GOOGLE_DISCOVER],
  ['https://www.facebook.com/',                      SOURCES.SOCIAL_META],
  ['https://m.facebook.com/',                        SOURCES.SOCIAL_META],
  ['https://l.facebook.com/l.php',                   SOURCES.SOCIAL_META],
  ['https://www.instagram.com/',                     SOURCES.SOCIAL_META],
  ['https://l.instagram.com/',                       SOURCES.SOCIAL_META],
  ['https://t.co/abc',                               SOURCES.SOCIAL_X],
  ['https://twitter.com/',                           SOURCES.SOCIAL_X],
  ['https://x.com/',                                 SOURCES.SOCIAL_X],
  ['https://www.tiktok.com/',                        SOURCES.SOCIAL_TIKTOK],
  ['https://www.youtube.com/',                       SOURCES.SOCIAL_YOUTUBE],
  ['https://www.reddit.com/r/soccer',                SOURCES.SOCIAL_REDDIT],
  ['https://www.tvarenasport.com/fudbal',            SOURCES.INTERNAL],
  ['https://m.tvarenasport.hr/',                     SOURCES.INTERNAL],
  ['https://www.blic.rs/sport',                      SOURCES.REFERRAL],
];

for (const [referrer, expected] of referrerCases) {
  test(`korak 4: ${referrer} -> ${expected}`, () => {
    assert.equal(resolve('https://tvarenasport.com/a', referrer).traffic_source, expected);
  });
}

test('Discover se ne mesa sa organic-om (sekcija 5.3)', () => {
  const discover = resolve('https://tvarenasport.com/a', 'https://news.google.com/');
  const organic = resolve('https://tvarenasport.com/a', 'https://www.google.com/');
  assert.notEqual(discover.traffic_source, organic.traffic_source);
});

// ── Korak 5: direct ─────────────────────────────────────────────────────────
test('korak 5: nema referrer-a i nema UTM-a -> direct', () => {
  const r = resolve('https://tvarenasport.com/a', '');
  assert.equal(r.traffic_source, SOURCES.DIRECT);
  assert.equal(r.channel_detail, '');
});

// ── Robusnost ───────────────────────────────────────────────────────────────
test('malformiran referrer ne rusi resolver', () => {
  for (const bad of [null, undefined, '', 'not a url', '://///', 'javascript:void(0)']) {
    const r = resolveTrafficSource({ url: 'https://tvarenasport.com/a', referrer: bad, internalDomains: INTERNAL });
    assert.ok(typeof r.traffic_source === 'string' && r.traffic_source.length > 0);
  }
});

test('malformiran URL ne rusi resolver', () => {
  const r = resolveTrafficSource({ url: 'http://[::bad', referrer: '', internalDomains: INTERNAL });
  assert.equal(r.traffic_source, SOURCES.DIRECT);
});

test('extractDomain skida www i podrzava android-app sheme', () => {
  assert.equal(extractDomain('https://www.google.com/x'), 'google.com');
  assert.equal(extractDomain('android-app://com.google.android.googlequicksearchbox/'), 'com.google.android.googlequicksearchbox');
  assert.equal(extractDomain('facebook.com/story'), 'facebook.com');
  assert.equal(extractDomain(''), '');
});

test('parseUrlParams vadi UTM i klik ID-jeve', () => {
  const p = parseUrlParams('https://x.com/a?utm_source=FB&utm_medium=CPC&gclid=Z1');
  assert.equal(p.utm_source, 'fb');
  assert.equal(p.utm_medium, 'cpc');
  assert.equal(p.gclid, 'z1');
});

test('eksplicitni utm objekat pobedjuje onaj iz URL-a', () => {
  const r = resolveTrafficSource({
    url: 'https://tvarenasport.com/a?utm_source=google',
    utm: { utm_source: 'tiktok' },
    internalDomains: INTERNAL,
  });
  assert.equal(r.traffic_source, SOURCES.SOCIAL_TIKTOK);
});
