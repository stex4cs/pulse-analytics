/**
 * A/B dodela naslova (sekcija 8.1, koraci 2-3).
 *
 * GET /ab/headline?articleId=X&sessionId=Y&site=rs
 *
 * Dodela je deterministicka po session_id: isti korisnik unutar sesije uvek
 * vidi istu varijantu. Nema stanja na serveru, nema upisa - samo hash.
 * Definicije testova se kesiraju iz Postgres-a (refresh 30s) da bi endpoint
 * ostao brz i pod saobracajem naslovne strane.
 */
import crypto from 'node:crypto';
import { pgQuery } from '@pulse/shared';

const CACHE_TTL_MS = 30_000;
const LOAD_TIMEOUT_MS = 5_000;

let cache = new Map();   // `${site}:${articleId}` -> test
let cachedAt = 0;
let refreshing = null;
let refreshTimer = null;

async function loadTests() {
  const rows = await pgQuery(
    `SELECT t.test_id, t.site, t.article_id, t.status, t.winner_variant,
            v.variant, v.headline, v.weight, v.is_control
       FROM ab_tests t
       JOIN ab_variants v ON v.test_id = t.test_id
      WHERE t.status IN ('running', 'completed')`,
  );

  const next = new Map();
  for (const r of rows) {
    const key = `${r.site}:${r.article_id}`;
    let entry = next.get(key);
    if (!entry) {
      entry = {
        testId: r.test_id,
        status: r.status,
        winner: r.winner_variant,
        variants: [],
      };
      next.set(key, entry);
    }
    entry.variants.push({
      variant: r.variant,
      headline: r.headline,
      weight: Math.max(1, Number(r.weight) || 1),
      isControl: r.is_control,
    });
  }
  for (const entry of next.values()) {
    entry.variants.sort((a, b) => a.variant.localeCompare(b.variant));
    entry.totalWeight = entry.variants.reduce((s, v) => s + v.weight, 0);
  }
  cache = next;
  cachedAt = Date.now();
}

/**
 * Osvezavanje kesa.
 *
 * Dva detalja koja izgledaju sitno a nisu:
 *
 * 1) TIMEOUT. Bez njega, jedan zaglavljen upit ostavlja `refreshing` zauvek
 *    postavljen, `if (refreshing) return refreshing` kratko spaja svaki sledeci
 *    poziv, i kes se TRAJNO zamrzne - urednik menja naslove, a sajt i dalje
 *    servira stare varijante, bez ijedne greske u logu.
 *
 * 2) Greska se uvek loguje i ne obara proces. Stari kes je bolji od nikakvog:
 *    ako Postgres trenutno ne odgovara, i dalje serviramo poslednje poznate
 *    varijante umesto da naslovna strana ostane bez naslova.
 */
export async function refreshAbCache(log) {
  if (refreshing) return refreshing;

  const withTimeout = Promise.race([
    loadTests(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`A/B kes: upit nije zavrsio za ${LOAD_TIMEOUT_MS}ms`)),
        LOAD_TIMEOUT_MS).unref?.();
    }),
  ]);

  refreshing = withTimeout
    .catch((err) => {
      log?.error?.({ err: err.message }, 'A/B kes nije osvezen - zadrzavam prethodni');
    })
    .finally(() => { refreshing = null; });

  return refreshing;
}

/**
 * Periodicno osvezavanje. Bez ovoga kes zavisi od toga da li neko slucajno
 * zatrazi naslov u pravom trenutku, pa se novi test pojavljuje nepredvidivo.
 */
export function startAbCacheRefresh(log) {
  if (refreshTimer) return refreshTimer;
  refreshTimer = setInterval(() => { refreshAbCache(log); }, CACHE_TTL_MS);
  refreshTimer.unref?.();
  return refreshTimer;
}

export function stopAbCacheRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** Stabilan bucket 0..totalWeight-1 iz (testId, sessionId). */
export function assignBucket(testId, sessionId, totalWeight) {
  const digest = crypto.createHash('md5').update(`${testId}:${sessionId}`).digest();
  const n = digest.readUInt32BE(0);
  return n % totalWeight;
}

/**
 * @returns {{testId: string, variant: string, headline: string} | null}
 */
export function pickVariant(site, articleId, sessionId) {
  const entry = cache.get(`${site}:${articleId}`);
  if (!entry || !entry.variants.length) return null;

  // Zavrsen test sa pobednikom -> svi vide pobednika (sekcija 8.3)
  if (entry.status === 'completed' && entry.winner) {
    const win = entry.variants.find((v) => v.variant === entry.winner) ?? entry.variants[0];
    return { testId: entry.testId, variant: win.variant, headline: win.headline, final: true };
  }

  if (!sessionId) {
    const control = entry.variants.find((v) => v.isControl) ?? entry.variants[0];
    return { testId: entry.testId, variant: control.variant, headline: control.headline, final: false };
  }

  let bucket = assignBucket(entry.testId, sessionId, entry.totalWeight);
  for (const v of entry.variants) {
    bucket -= v.weight;
    if (bucket < 0) {
      return { testId: entry.testId, variant: v.variant, headline: v.headline, final: false };
    }
  }
  const last = entry.variants[entry.variants.length - 1];
  return { testId: entry.testId, variant: last.variant, headline: last.headline, final: false };
}

export function isCacheStale() {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

export function registerAbRoutes(app) {
  app.get('/ab/headline', async (req, reply) => {
    const { articleId = '', sessionId = '', site = 'rs' } = req.query ?? {};

    if (isCacheStale()) refreshAbCache(app.log);

    reply.header('Cache-Control', 'no-store');
    if (!articleId) return reply.code(200).send({ test: null });

    const picked = pickVariant(String(site), String(articleId), String(sessionId));
    return reply.code(200).send({
      test: picked
        ? { testId: picked.testId, variant: picked.variant, headline: picked.headline, final: picked.final }
        : null,
    });
  });

  // Batch varijanta za naslovnu stranu: jedan poziv za celu listu clanaka
  app.post('/ab/headlines', async (req, reply) => {
    const body = req.body ?? {};
    const ids = Array.isArray(body.articleIds) ? body.articleIds.slice(0, 100) : [];
    const sessionId = String(body.sessionId ?? '');
    const site = String(body.site ?? 'rs');

    if (isCacheStale()) refreshAbCache(app.log);

    const out = {};
    for (const id of ids) {
      const picked = pickVariant(site, String(id), sessionId);
      if (picked) {
        out[id] = { testId: picked.testId, variant: picked.variant, headline: picked.headline };
      }
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(200).send({ tests: out });
  });
}
