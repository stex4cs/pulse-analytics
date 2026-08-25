/**
 * Testovi za pravila vidljivosti (sekcija 11) i pomocnike ruta.
 * Ne diraju bazu - ciste funkcije.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorScope, siteScope, ROLES } from '../src/scope.js';
import { dateRange, orderBy, toCsv, trend, previousRange, limit } from '../src/utils.js';

const admin = { role: ROLES.ADMIN, sites: ['rs', 'hr'] };
const editor = { role: ROLES.EDITOR, sites: ['rs'] };
const author = { role: ROLES.AUTHOR, authorSlug: 'milan-nastic', sites: ['rs'] };

// ── authorScope ─────────────────────────────────────────────────────────────
test('autor uvek dobija filter na samog sebe', () => {
  assert.deepEqual(authorScope(author, undefined), { author: 'milan-nastic' });
  assert.deepEqual(authorScope(author, 'milan-nastic'), { author: 'milan-nastic' });
});

test('autor ne moze da vidi tudju statistiku', () => {
  assert.throws(() => authorScope(author, 'jelena-popovic'), (err) => err.statusCode === 403);
});

test('urednik i admin vide koga traze', () => {
  assert.deepEqual(authorScope(editor, 'jelena-popovic'), { author: 'jelena-popovic' });
  assert.deepEqual(authorScope(admin, undefined), { author: null });
});

// ── siteScope ───────────────────────────────────────────────────────────────
test('podrazumevani sajt je prvi dozvoljeni', () => {
  assert.equal(siteScope(admin, undefined), 'rs');
});

test('trazeni sajt van dozvoljenih je 403', () => {
  assert.throws(() => siteScope(editor, 'hr'), (err) => err.statusCode === 403);
});

test('dozvoljeni sajt prolazi', () => {
  assert.equal(siteScope(admin, 'hr'), 'hr');
});

// ── dateRange ───────────────────────────────────────────────────────────────
test('days=7 daje sedmodnevni opseg zakljucno sa danas', () => {
  const r = dateRange({ days: 7 });
  const span = (new Date(r.to) - new Date(r.from)) / 86_400_000;
  assert.equal(span, 6);
});

test('eksplicitni from/to se postuju', () => {
  const r = dateRange({ from: '2026-08-01', to: '2026-08-10' });
  assert.equal(r.from, '2026-08-01');
  assert.equal(r.to, '2026-08-10');
});

test('obrnut opseg se ispravlja umesto da vrati prazno', () => {
  const r = dateRange({ from: '2026-08-10', to: '2026-08-01' });
  assert.equal(r.from, '2026-08-01');
  assert.equal(r.to, '2026-08-10');
});

test('neispravan datum pada na podrazumevani', () => {
  const r = dateRange({ from: 'DROP TABLE users', to: '2026-08-10' });
  assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
});

test('days je ogranicen na 400', () => {
  assert.equal(dateRange({ days: 100000 }).days, 400);
});

// ── orderBy: bela lista, nema SQL injekcije ─────────────────────────────────
test('sort van bele liste pada na podrazumevanu kolonu', () => {
  const sql = orderBy({ sort: 'pageviews; DROP TABLE users', dir: 'asc' }, ['pageviews', 'author'], 'pageviews');
  assert.equal(sql, 'pageviews ASC NULLS LAST');
});

test('smer moze biti samo ASC ili DESC', () => {
  assert.match(orderBy({ dir: 'DESC; --' }, ['pageviews'], 'pageviews'), /DESC NULLS LAST$/);
});

test('limit je ogranicen', () => {
  assert.equal(limit({ limit: 99999 }, 50, 500), 500);
  assert.equal(limit({ limit: -5 }, 50, 500), 50);
});

// ── CSV ─────────────────────────────────────────────────────────────────────
test('CSV escape-uje zareze, navodnike i nove redove', () => {
  const csv = toCsv([{ a: 'Zvezda, Partizan', b: 'kaže "gol"', c: 'prvi\ndrugi' }]);
  assert.equal(csv.split('\n')[0], 'a,b,c');
  assert.ok(csv.includes('"Zvezda, Partizan"'));
  assert.ok(csv.includes('"kaže ""gol"""'));
});

test('prazan skup daje prazan CSV', () => {
  assert.equal(toCsv([]), '');
});

// ── trend / previousRange ───────────────────────────────────────────────────
test('trend racuna procentualnu promenu', () => {
  assert.equal(trend(150, 100), 50);
  assert.equal(trend(50, 100), -50);
  assert.equal(trend(0, 0), 0);
  assert.equal(trend(10, 0), 100);
});

test('prethodni period ima istu duzinu i ne preklapa se', () => {
  const prev = previousRange('2026-08-08', '2026-08-14');
  assert.equal(prev.from, '2026-08-01');
  assert.equal(prev.to, '2026-08-07');
});
