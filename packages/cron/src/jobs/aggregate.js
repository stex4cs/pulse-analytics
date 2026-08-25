/**
 * Dnevne agregacije ClickHouse -> PostgreSQL (sekcija 7).
 *
 * Dashboard nikad ne pita ClickHouse za standardne izvestaje, pa sve sto
 * dashboard prikazuje mora da zavrsi ovde.
 *
 * Napomene:
 *  - unique_visitors se cita iskljucivo preko uniqMerge (sekcija 15.3)
 *  - live-blog se izbacuje iz proseka vremena/scroll-a (sekcija 15.5)
 *  - sve u UTC (sekcija 15.4)
 */
import { chQuery } from '@pulse/shared';
import { bulkUpsert } from '../upsert.js';

const EXCLUDE_LIVEBLOG = "content_type != 'live-blog'";

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const round2 = (v) => Math.round(num(v) * 100) / 100;
const pct = (part, whole) => (num(whole) > 0 ? round2((num(part) / num(whole)) * 100) : 0);

/** Prosecna maksimalna dubina scroll-a iz kumulativnih brojaca. */
function avgScrollDepth(r25, r50, r75, r100) {
  const base = num(r25);
  if (base === 0) return 0;
  const weighted =
    25 * (num(r25) - num(r50)) +
    50 * (num(r50) - num(r75)) +
    75 * (num(r75) - num(r100)) +
    100 * num(r100);
  return round2(weighted / base);
}

/** [{key, traffic_source, pageviews}] -> Map(key -> {source: pv}) */
function breakdownMap(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r.traffic_source] = num(r.pageviews);
  }
  return map;
}

// ── Autori ──────────────────────────────────────────────────────────────────
export async function aggregateAuthors(from, to) {
  const params = { from, to };

  const base = await chQuery(`
    SELECT date, site, author,
           sum(pageviews)               AS pageviews,
           uniqMerge(visitors_state)    AS unique_visitors,
           uniqMerge(articles_state)    AS articles_viewed
      FROM pulse.author_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, author`, params);

  if (!base.length) return 0;

  const engagement = await chQuery(`
    SELECT date, site, author,
           sum(reached_25) AS r25, sum(reached_50) AS r50,
           sum(reached_75) AS r75, sum(reached_100) AS r100
      FROM pulse.engagement_daily
     WHERE date BETWEEN {from:Date} AND {to:Date} AND ${EXCLUDE_LIVEBLOG}
     GROUP BY date, site, author`, params);

  const timing = await chQuery(`
    SELECT date, site, author,
           sum(samples)             AS samples,
           sum(active_time_ms_sum)  AS active_ms,
           sum(read_completions)    AS reads
      FROM pulse.timeonpage_daily
     WHERE date BETWEEN {from:Date} AND {to:Date} AND ${EXCLUDE_LIVEBLOG}
     GROUP BY date, site, author`, params);

  const sources = await chQuery(`
    SELECT date, site, author, traffic_source, sum(pageviews) AS pageviews
      FROM pulse.author_source_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, author, traffic_source`, params);

  const k = (r) => `${r.date}|${r.site}|${r.author}`;
  const eng = new Map(engagement.map((r) => [k(r), r]));
  const tim = new Map(timing.map((r) => [k(r), r]));
  const src = breakdownMap(sources, k);

  // Broj objavljenih clanaka po autoru po danu - iz vec popunjenog article_stats
  const published = await publishedCounts('author', from, to);

  const rows = base.map((r) => {
    const key = k(r);
    const e = eng.get(key) ?? {};
    const t = tim.get(key) ?? {};
    const articlesPublished = published.get(key) ?? 0;
    const denominator = articlesPublished || num(r.articles_viewed) || 1;

    return {
      site: r.site,
      author: r.author,
      period_type: 'day',
      period_start: r.date,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
      articles_published: articlesPublished,
      avg_pageviews_per_article: round2(num(r.pageviews) / denominator),
      avg_time_on_page_sec: num(t.samples) > 0 ? round2(num(t.active_ms) / num(t.samples) / 1000) : 0,
      avg_scroll_completion: avgScrollDepth(e.r25, e.r50, e.r75, e.r100),
      read_completion_rate: pct(t.reads, t.samples),
      source_breakdown: JSON.stringify(src.get(key) ?? {}),
    };
  });

  return bulkUpsert(
    'author_stats',
    ['site', 'author', 'period_type', 'period_start', 'pageviews', 'unique_visitors',
      'articles_published', 'avg_pageviews_per_article', 'avg_time_on_page_sec',
      'avg_scroll_completion', 'read_completion_rate', 'source_breakdown'],
    ['site', 'author', 'period_type', 'period_start'],
    rows,
  );
}

// ── Kategorije ──────────────────────────────────────────────────────────────
export async function aggregateCategories(from, to) {
  const params = { from, to };

  const base = await chQuery(`
    SELECT date, site, category, category_root,
           sum(pageviews)            AS pageviews,
           uniqMerge(visitors_state) AS unique_visitors,
           uniqMerge(articles_state) AS articles_viewed
      FROM pulse.category_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, category, category_root`, params);

  if (!base.length) return 0;

  const engagement = await chQuery(`
    SELECT date, site, category,
           sum(reached_25) AS r25, sum(reached_50) AS r50,
           sum(reached_75) AS r75, sum(reached_100) AS r100
      FROM pulse.engagement_daily
     WHERE date BETWEEN {from:Date} AND {to:Date} AND ${EXCLUDE_LIVEBLOG}
     GROUP BY date, site, category`, params);

  const timing = await chQuery(`
    SELECT date, site, category,
           sum(samples) AS samples, sum(active_time_ms_sum) AS active_ms, sum(read_completions) AS reads
      FROM pulse.timeonpage_daily
     WHERE date BETWEEN {from:Date} AND {to:Date} AND ${EXCLUDE_LIVEBLOG}
     GROUP BY date, site, category`, params);

  const sources = await chQuery(`
    SELECT date, site, category, traffic_source, sum(pageviews) AS pageviews
      FROM pulse.category_source_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, category, traffic_source`, params);

  const k = (r) => `${r.date}|${r.site}|${r.category}`;
  const eng = new Map(engagement.map((r) => [k(r), r]));
  const tim = new Map(timing.map((r) => [k(r), r]));
  const src = breakdownMap(sources, k);
  const published = await publishedCounts('category', from, to);

  const rows = base.map((r) => {
    const key = k(r);
    const e = eng.get(key) ?? {};
    const t = tim.get(key) ?? {};
    const articlesPublished = published.get(key) ?? 0;
    const denominator = articlesPublished || num(r.articles_viewed) || 1;

    return {
      site: r.site,
      category: r.category,
      category_root: r.category_root,
      period_type: 'day',
      period_start: r.date,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
      articles_published: articlesPublished,
      avg_pageviews_per_article: round2(num(r.pageviews) / denominator),
      avg_time_on_page_sec: num(t.samples) > 0 ? round2(num(t.active_ms) / num(t.samples) / 1000) : 0,
      avg_scroll_completion: avgScrollDepth(e.r25, e.r50, e.r75, e.r100),
      read_completion_rate: pct(t.reads, t.samples),
      source_breakdown: JSON.stringify(src.get(key) ?? {}),
    };
  });

  return bulkUpsert(
    'category_stats',
    ['site', 'category', 'category_root', 'period_type', 'period_start', 'pageviews',
      'unique_visitors', 'articles_published', 'avg_pageviews_per_article',
      'avg_time_on_page_sec', 'avg_scroll_completion', 'read_completion_rate', 'source_breakdown'],
    ['site', 'category', 'period_type', 'period_start'],
    rows,
  );
}

// ── Tagovi ──────────────────────────────────────────────────────────────────
export async function aggregateTags(from, to) {
  const rows = await chQuery(`
    SELECT date, site, tag,
           sum(pageviews)            AS pageviews,
           uniqMerge(sessions_state) AS sessions,
           uniqMerge(articles_state) AS articles
      FROM pulse.tag_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, tag
    HAVING pageviews > 0`, { from, to });

  if (!rows.length) return 0;

  return bulkUpsert(
    'tag_stats',
    ['site', 'tag', 'period_type', 'period_start', 'pageviews', 'unique_visitors', 'articles_count'],
    ['site', 'tag', 'period_type', 'period_start'],
    rows.map((r) => ({
      site: r.site,
      tag: r.tag,
      period_type: 'day',
      period_start: r.date,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.sessions),
      articles_count: num(r.articles),
    })),
    // trending_score se racuna posebnim poslom - ne gazimo ga ovde
    ['pageviews', 'unique_visitors', 'articles_count'],
  );
}

// ── Traffic sources ─────────────────────────────────────────────────────────
export async function aggregateSources(from, to) {
  const params = { from, to };

  const base = await chQuery(`
    SELECT date, site, traffic_source, category_root,
           sum(pageviews)            AS pageviews,
           uniqMerge(visitors_state) AS unique_visitors
      FROM pulse.source_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, traffic_source, category_root`, params);

  if (!base.length) return 0;

  // Sesije se prvo skupljaju po session_id, pa tek onda po kanalu -
  // AggregatingMergeTree ne garantuje da su delovi vec spojeni.
  const sessions = await chQuery(`
    SELECT date, site, traffic_source, category_root,
           count()                              AS sessions,
           avg(pageviews)                       AS avg_pages,
           countIf(pageviews <= 1) / count()    AS bounce,
           avg(active_time_ms) / 1000           AS avg_sec
      FROM (
        SELECT date, site, session_id,
               sum(pageviews)            AS pageviews,
               sum(active_time_ms)       AS active_time_ms,
               any(traffic_source)       AS traffic_source,
               any(entry_category_root)  AS category_root
          FROM pulse.sessions
         WHERE date BETWEEN {from:Date} AND {to:Date}
         GROUP BY date, site, session_id
      )
     GROUP BY date, site, traffic_source, category_root`, params);

  const k = (r) => `${r.date}|${r.site}|${r.traffic_source}|${r.category_root}`;
  const sess = new Map(sessions.map((r) => [k(r), r]));

  const rows = base.map((r) => {
    const s = sess.get(k(r)) ?? {};
    return {
      site: r.site,
      traffic_source: r.traffic_source,
      category_root: r.category_root || '',
      period_type: 'day',
      period_start: r.date,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
      sessions: num(s.sessions),
      avg_session_pages: round2(s.avg_pages),
      bounce_rate: round2(num(s.bounce) * 100),
      avg_session_sec: round2(s.avg_sec),
    };
  });

  const written = await bulkUpsert(
    'source_stats',
    ['site', 'traffic_source', 'category_root', 'period_type', 'period_start',
      'pageviews', 'unique_visitors', 'sessions', 'avg_session_pages', 'bounce_rate', 'avg_session_sec'],
    ['site', 'traffic_source', 'category_root', 'period_type', 'period_start'],
    rows,
  );

  // Presek kanal x device (sekcija 10.5)
  const devices = await chQuery(`
    SELECT date, site, traffic_source, device_type,
           sum(pageviews)            AS pageviews,
           uniqMerge(visitors_state) AS unique_visitors
      FROM pulse.source_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, traffic_source, device_type`, params);

  await bulkUpsert(
    'source_device_stats',
    ['site', 'traffic_source', 'device_type', 'period_type', 'period_start', 'pageviews', 'unique_visitors'],
    ['site', 'traffic_source', 'device_type', 'period_type', 'period_start'],
    devices.map((r) => ({
      site: r.site,
      traffic_source: r.traffic_source,
      device_type: r.device_type || 'unknown',
      period_type: 'day',
      period_start: r.date,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
    })),
  );

  return written;
}

// ── UTM kampanje ────────────────────────────────────────────────────────────
export async function aggregateCampaigns(from, to) {
  const rows = await chQuery(`
    SELECT date, site, utm_source, utm_medium, utm_campaign,
           sum(pageviews)            AS pageviews,
           uniqMerge(sessions_state) AS sessions
      FROM pulse.campaign_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY date, site, utm_source, utm_medium, utm_campaign`, { from, to });

  if (!rows.length) return 0;

  return bulkUpsert(
    'campaign_stats',
    ['site', 'utm_source', 'utm_medium', 'utm_campaign', 'period_type', 'period_start', 'pageviews', 'sessions'],
    ['site', 'utm_source', 'utm_medium', 'utm_campaign', 'period_type', 'period_start'],
    rows.map((r) => ({
      site: r.site,
      utm_source: r.utm_source || '(none)',
      utm_medium: r.utm_medium || '(none)',
      utm_campaign: r.utm_campaign,
      period_type: 'day',
      period_start: r.date,
      pageviews: num(r.pageviews),
      sessions: num(r.sessions),
    })),
  );
}

// ── Satni saobracaj (grafik "danas vs isti dan prosle nedelje") ─────────────
export async function aggregateHourlyTraffic(hoursBack = 200) {
  const rows = await chQuery(`
    SELECT formatDateTime(toStartOfHour(minute), '%Y-%m-%dT%H:00:00Z') AS hour_utc,
           site,
           category_root,
           sum(pageviews)            AS pageviews,
           uniqMerge(sessions_state) AS sessions
      FROM pulse.minute_pulse
     WHERE minute >= now() - INTERVAL {hours:UInt16} HOUR
     GROUP BY hour_utc, site, category_root`, { hours: hoursBack });

  if (!rows.length) return 0;

  // Ukupno po satu (category_root = '') + razrada po kategoriji
  const totals = new Map();
  for (const r of rows) {
    const key = `${r.site}|${r.hour_utc}`;
    const t = totals.get(key) ?? { pageviews: 0, sessions: 0 };
    t.pageviews += num(r.pageviews);
    t.sessions = Math.max(t.sessions, num(r.sessions));
    totals.set(key, t);
  }

  const out = rows.map((r) => ({
    site: r.site,
    hour_utc: r.hour_utc,
    category_root: r.category_root || '(none)',
    pageviews: num(r.pageviews),
    sessions: num(r.sessions),
  }));

  for (const [key, t] of totals) {
    const [site, hour] = key.split('|');
    out.push({ site, hour_utc: hour, category_root: '', pageviews: t.pageviews, sessions: t.sessions });
  }

  return bulkUpsert(
    'hourly_traffic',
    ['site', 'hour_utc', 'category_root', 'pageviews', 'sessions'],
    ['site', 'hour_utc', 'category_root'],
    out,
  );
}

/**
 * Broj objavljenih clanaka po autoru/kategoriji po danu.
 * Cita iz vec popunjenog article_stats - jeftinije nego cesljati sirove evente.
 */
async function publishedCounts(dimension, from, to) {
  const { pgQuery } = await import('@pulse/shared');
  const column = dimension === 'author' ? 'author' : 'category';
  const rows = await pgQuery(
    `SELECT to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
            site, ${column} AS dim, count(*)::int AS n
       FROM article_stats
      WHERE published_at IS NOT NULL
        AND published_at >= $1::date
        AND published_at < ($2::date + INTERVAL '1 day')
        AND ${column} IS NOT NULL AND ${column} <> ''
      GROUP BY 1, 2, 3`,
    [from, to],
  );
  return new Map(rows.map((r) => [`${r.date}|${r.site}|${r.dim}`, Number(r.n)]));
}

/** Sve dnevne agregacije za opseg datuma. */
export async function aggregateDailyRange(from, to) {
  const results = {
    authors: await aggregateAuthors(from, to),
    categories: await aggregateCategories(from, to),
    tags: await aggregateTags(from, to),
    sources: await aggregateSources(from, to),
    campaigns: await aggregateCampaigns(from, to),
  };
  results.rows = Object.values(results).reduce((a, b) => a + (Number(b) || 0), 0);
  return results;
}
