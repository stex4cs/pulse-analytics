/**
 * article_stats: red po clanku, sve sto trazi ekran 10.6.
 *
 * Hot rezim (svakih 5 min) gleda clanke aktivne poslednjih 2 dana; nocni
 * prolaz osvezava sirok prozor. Trending score se racuna ovde jer mu trebaju
 * isti prozori (sekcija 9.3).
 */
import { chQuery, trendingScore } from '@pulse/shared';
import { bulkUpsert } from '../upsert.js';

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const round2 = (v) => Math.round(num(v) * 100) / 100;
const pct = (part, whole) => (num(whole) > 0 ? round2((num(part) / num(whole)) * 100) : 0);

export async function aggregateArticles(activeDays = 2) {
  const params = { days: activeDays };

  const base = await chQuery(`
    SELECT site,
           article_id,
           anyLast(title)                AS title,
           anyLast(url)                  AS url,
           anyLast(tags)                 AS tags,
           any(author)                   AS author,
           any(category)                 AS category,
           any(content_type)             AS content_type,
           anyLast(word_count)           AS word_count,
           toString(anyLast(published_at)) AS published_at,
           sum(pageviews)                AS pageviews_total,
           sumIf(pageviews, hour >= toStartOfHour(now() - INTERVAL 1 HOUR))  AS pv_1h,
           sumIf(pageviews, hour >= now() - INTERVAL 24 HOUR)                AS pv_24h,
           sumIf(pageviews, hour >= now() - INTERVAL 7 DAY)                  AS pv_7d,
           uniqMerge(visitors_state)     AS unique_visitors
      FROM pulse.article_hourly
     WHERE (site, article_id) IN (
             SELECT site, article_id FROM pulse.article_hourly
              WHERE hour >= now() - INTERVAL {days:UInt16} DAY
           )
       AND article_id != ''
     GROUP BY site, article_id`, params);

  if (!base.length) return 0;

  const engagement = await chQuery(`
    SELECT site, article_id,
           sum(reached_25) AS r25, sum(reached_50) AS r50,
           sum(reached_75) AS r75, sum(reached_100) AS r100
      FROM pulse.engagement_daily
     WHERE date >= today() - {days:UInt16} - 7
     GROUP BY site, article_id`, params);

  const timing = await chQuery(`
    SELECT site, article_id,
           sum(samples) AS samples, sum(active_time_ms_sum) AS active_ms, sum(read_completions) AS reads
      FROM pulse.timeonpage_daily
     WHERE date >= today() - {days:UInt16} - 7
     GROUP BY site, article_id`, params);

  const sources = await chQuery(`
    SELECT site, article_id, traffic_source, sum(pageviews) AS pageviews
      FROM pulse.article_source_daily
     WHERE date >= today() - {days:UInt16} - 7
     GROUP BY site, article_id, traffic_source`, params);

  const k = (r) => `${r.site}|${r.article_id}`;
  const eng = new Map(engagement.map((r) => [k(r), r]));
  const tim = new Map(timing.map((r) => [k(r), r]));

  const src = new Map();
  for (const r of sources) {
    const key = k(r);
    if (!src.has(key)) src.set(key, {});
    src.get(key)[r.traffic_source] = num(r.pageviews);
  }

  const rows = base.map((r) => {
    const key = k(r);
    const e = eng.get(key) ?? {};
    const t = tim.get(key) ?? {};

    // Prosek po satu u poslednja 24h je osnova za trending (sekcija 9.3)
    const avgPerHour24h = num(r.pv_24h) / 24;

    const publishedAt = r.published_at && !r.published_at.startsWith('1970')
      ? r.published_at.replace(' ', 'T') + 'Z'
      : null;

    return {
      site: r.site,
      article_id: r.article_id,
      title: r.title || null,
      url: r.url || null,
      author: r.author || null,
      category: r.category || null,
      category_root: (r.category || '').split('/')[0] || null,
      content_type: r.content_type || null,
      tags: Array.isArray(r.tags) ? r.tags : [],
      word_count: num(r.word_count),
      published_at: publishedAt,
      pageviews_total: num(r.pageviews_total),
      pageviews_1h: num(r.pv_1h),
      pageviews_24h: num(r.pv_24h),
      pageviews_7d: num(r.pv_7d),
      unique_visitors: num(r.unique_visitors),
      avg_time_on_page_sec: num(t.samples) > 0 ? round2(num(t.active_ms) / num(t.samples) / 1000) : 0,
      scroll_completion_rate: pct(e.r100, e.r25),
      read_completion_rate: pct(t.reads, t.samples),
      trending_score: round2(trendingScore(num(r.pv_1h), avgPerHour24h)),
      source_breakdown: JSON.stringify(src.get(key) ?? {}),
      scroll_funnel: JSON.stringify({
        p25: num(e.r25), p50: num(e.r50), p75: num(e.r75), p100: num(e.r100),
      }),
    };
  });

  return bulkUpsert(
    'article_stats',
    ['site', 'article_id', 'title', 'url', 'author', 'category', 'category_root', 'content_type',
      'tags', 'word_count', 'published_at', 'pageviews_total', 'pageviews_1h', 'pageviews_24h',
      'pageviews_7d', 'unique_visitors', 'avg_time_on_page_sec', 'scroll_completion_rate',
      'read_completion_rate', 'trending_score', 'source_breakdown', 'scroll_funnel'],
    ['site', 'article_id'],
    rows,
  );
}
