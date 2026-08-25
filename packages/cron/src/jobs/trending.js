/**
 * Trending detekcija za tagove (sekcija 9.3).
 *
 * trending_score = (pregledi_poslednji_sat / prosek_po_satu_24h) * log10(pregledi)
 *
 * Clanci dobijaju svoj skor u articles.js jer im trebaju isti prozori.
 */
import { chQuery, pgQuery, trendingScore } from '@pulse/shared';
import { bulkUpsert } from '../upsert.js';

const num = (v) => Number(v ?? 0);

export async function computeTagTrending() {
  const rows = await chQuery(`
    SELECT site, tag,
           sumIf(pageviews, hour >= toStartOfHour(now() - INTERVAL 1 HOUR)) AS pv_1h,
           sum(pageviews) AS pv_24h
      FROM pulse.tag_hourly
     WHERE hour >= now() - INTERVAL 24 HOUR
     GROUP BY site, tag
    HAVING pv_1h > 0`);

  if (!rows.length) return 0;

  const today = new Date().toISOString().slice(0, 10);

  const scored = rows.map((r) => ({
    site: r.site,
    tag: r.tag,
    period_type: 'day',
    period_start: today,
    trending_score: Math.round(trendingScore(num(r.pv_1h), num(r.pv_24h) / 24) * 10000) / 10000,
  }));

  // Redovi za danas mozda jos ne postoje ako je tag tek dobio prvi pregled -
  // upsert ih pravi sa nulama, a aggregateTags ih posle popuni.
  const written = await bulkUpsert(
    'tag_stats',
    ['site', 'tag', 'period_type', 'period_start', 'trending_score'],
    ['site', 'tag', 'period_type', 'period_start'],
    scored,
    ['trending_score'],
  );

  // Skor stariji od 24h vise nije "trending" - nuliramo da ne visi u UI-ju
  await pgQuery(
    `UPDATE tag_stats SET trending_score = 0
      WHERE period_type = 'day' AND period_start < $1::date AND trending_score <> 0`,
    [today],
  );

  return written;
}
