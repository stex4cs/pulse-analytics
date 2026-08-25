/**
 * Statistika: A/B znacajnost (sekcija 8.2) i trending score (sekcija 9.3).
 */

/** Normalna CDF - Abramowitz & Stegun 7.1.26, greska < 1.5e-7. */
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-proportion z-test (dvostrani).
 *
 * @param {number} clicksA  konverzije varijante A (kontrola)
 * @param {number} impressionsA
 * @param {number} clicksB  konverzije varijante B
 * @param {number} impressionsB
 * @returns {{z: number, pValue: number, confidence: number, ctrA: number, ctrB: number, lift: number}}
 */
export function twoProportionZTest(clicksA, impressionsA, clicksB, impressionsB) {
  const nA = Math.max(0, impressionsA);
  const nB = Math.max(0, impressionsB);
  const empty = { z: 0, pValue: 1, confidence: 0, ctrA: 0, ctrB: 0, lift: 0 };
  if (nA === 0 || nB === 0) return empty;

  const pA = clicksA / nA;
  const pB = clicksB / nB;
  const pPool = (clicksA + clicksB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));

  if (se === 0) return { ...empty, ctrA: pA, ctrB: pB };

  const z = (pB - pA) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  return {
    z,
    pValue,
    confidence: 1 - pValue,
    ctrA: pA,
    ctrB: pB,
    lift: pA > 0 ? (pB - pA) / pA : 0,
  };
}

/**
 * Ocena A/B testa. Pobednik se NE proglasava ispod praga (sekcija 8.2) -
 * "jos nema dovoljno podataka" je tacan odgovor, lazni pobednik nije.
 *
 * @param {Array<{variant: string, impressions: number, clicks: number, is_control?: boolean}>} variants
 * @param {{minImpressions?: number, confidenceTarget?: number}} opts
 */
export function evaluateAbTest(variants, opts = {}) {
  const minImpressions = opts.minImpressions ?? 1000;
  const confidenceTarget = opts.confidenceTarget ?? 0.95;

  const rows = variants.map((v) => ({
    variant: v.variant,
    impressions: Number(v.impressions) || 0,
    clicks: Number(v.clicks) || 0,
    isControl: Boolean(v.is_control ?? v.isControl),
    ctr: (Number(v.impressions) || 0) > 0 ? (Number(v.clicks) || 0) / Number(v.impressions) : 0,
    pValue: null,
    confidence: 0,
    isSignificant: false,
    lift: 0,
  }));

  if (rows.length < 2) {
    return { rows, winner: null, hasEnoughData: false, reason: 'need_two_variants' };
  }

  const control = rows.find((r) => r.isControl) ?? rows.reduce((a, b) => (a.impressions >= b.impressions ? a : b));
  const underSampled = rows.filter((r) => r.impressions < minImpressions);

  for (const row of rows) {
    if (row.variant === control.variant) continue;
    const t = twoProportionZTest(control.clicks, control.impressions, row.clicks, row.impressions);
    row.pValue = t.pValue;
    row.confidence = t.confidence;
    row.lift = t.lift;
    row.isSignificant = t.confidence >= confidenceTarget;
  }

  if (underSampled.length > 0) {
    const needed = Math.max(...underSampled.map((r) => minImpressions - r.impressions));
    return {
      rows,
      winner: null,
      hasEnoughData: false,
      reason: 'insufficient_sample',
      impressionsNeeded: needed,
      minImpressions,
    };
  }

  const best = rows.reduce((a, b) => (b.ctr > a.ctr ? b : a));
  const significant = best.variant === control.variant
    ? rows.filter((r) => r.variant !== control.variant).every((r) => r.isSignificant)
    : best.isSignificant;

  return {
    rows,
    winner: significant ? best.variant : null,
    hasEnoughData: true,
    reason: significant ? 'winner' : 'not_significant',
    confidence: best.confidence,
    minImpressions,
  };
}

/**
 * Trending score (sekcija 9.3):
 *   (pregledi_poslednji_sat / prosek_po_satu_24h) * log10(pregledi_poslednji_sat)
 *
 * log faktor sprecava da clanak sa 5 -> 20 pregleda nadmasi onaj sa 5000 -> 12000.
 */
export function trendingScore(pageviewsLastHour, avgPageviewsPerHour24h) {
  const pv = Number(pageviewsLastHour) || 0;
  const avg = Number(avgPageviewsPerHour24h) || 0;
  if (pv <= 0) return 0;
  // Bez istorije: tretiramo kao odnos 1 da novi sadrzaj ne dobije beskonacan skor
  const ratio = avg > 0 ? pv / avg : 1;
  return ratio * Math.log10(Math.max(pv, 10));
}

/**
 * Read completion rate (sekcija 9.2): udeo citalaca koji su stigli do 75%+
 * I proveli vreme proporcionalno duzini teksta (200 reci/min).
 */
export function expectedReadMs(wordCount, wordsPerMinute = 200) {
  const wc = Number(wordCount) || 0;
  if (wc <= 0) return 0;
  return (wc / wordsPerMinute) * 60000;
}

export function isRealRead({ scrollDepth, activeTimeMs, wordCount }) {
  if ((Number(scrollDepth) || 0) < 75) return false;
  const need = expectedReadMs(wordCount);
  if (need === 0) return false;
  return (Number(activeTimeMs) || 0) >= need;
}

/** Percentil vrednosti u nizu - "kako se poredi" na Clanak detail ekranu (10.6). */
export function percentileOf(value, sortedAscending) {
  const arr = sortedAscending;
  if (!arr.length) return 0;
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / arr.length) * 100);
}
