/**
 * Nedeljni i mesecni agregati.
 *
 * VAZNO: ne sabiraju se dnevni redovi iz Postgres-a. Unique visitors se ne
 * sabira (sekcija 15.3), pa se ceo period racuna u ClickHouse-u preko
 * uniqMerge nad istim state kolonama.
 */
import { chQuery } from '@pulse/shared';
import { bulkUpsert } from '../upsert.js';

const num = (v) => Number(v ?? 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;
const pct = (part, whole) => (num(whole) > 0 ? round2((num(part) / num(whole)) * 100) : 0);

const PERIOD_EXPR = {
  week: 'toMonday(date)',
  month: 'toStartOfMonth(date)',
};

function periodExpr(periodType) {
  const expr = PERIOD_EXPR[periodType];
  if (!expr) throw new Error(`nepoznat period: ${periodType}`);
  return expr;
}

export async function rollupAuthors(periodType, from, to) {
  const p = periodExpr(periodType);

  const base = await chQuery(`
    SELECT toString(${p}) AS period_start, site, author,
           sum(pageviews)            AS pageviews,
           uniqMerge(visitors_state) AS unique_visitors,
           uniqMerge(articles_state) AS articles_viewed
      FROM pulse.author_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY period_start, site, author`, { from, to });

  if (!base.length) return 0;

  const timing = await chQuery(`
    SELECT toString(${p}) AS period_start, site, author,
           sum(samples) AS samples, sum(active_time_ms_sum) AS active_ms, sum(read_completions) AS reads
      FROM pulse.timeonpage_daily
     WHERE date BETWEEN {from:Date} AND {to:Date} AND content_type != 'live-blog'
     GROUP BY period_start, site, author`, { from, to });

  const engagement = await chQuery(`
    SELECT toString(${p}) AS period_start, site, author,
           sum(reached_25) AS r25, sum(reached_100) AS r100
      FROM pulse.engagement_daily
     WHERE date BETWEEN {from:Date} AND {to:Date} AND content_type != 'live-blog'
     GROUP BY period_start, site, author`, { from, to });

  const sources = await chQuery(`
    SELECT toString(${p}) AS period_start, site, author, traffic_source, sum(pageviews) AS pageviews
      FROM pulse.author_source_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY period_start, site, author, traffic_source`, { from, to });

  const k = (r) => `${r.period_start}|${r.site}|${r.author}`;
  const tim = new Map(timing.map((r) => [k(r), r]));
  const eng = new Map(engagement.map((r) => [k(r), r]));
  const src = new Map();
  for (const r of sources) {
    const key = k(r);
    if (!src.has(key)) src.set(key, {});
    src.get(key)[r.traffic_source] = num(r.pageviews);
  }

  const rows = base.map((r) => {
    const key = k(r);
    const t = tim.get(key) ?? {};
    const e = eng.get(key) ?? {};
    return {
      site: r.site,
      author: r.author,
      period_type: periodType,
      period_start: r.period_start,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
      articles_published: num(r.articles_viewed),
      avg_pageviews_per_article: round2(num(r.pageviews) / Math.max(1, num(r.articles_viewed))),
      avg_time_on_page_sec: num(t.samples) > 0 ? round2(num(t.active_ms) / num(t.samples) / 1000) : 0,
      avg_scroll_completion: pct(e.r100, e.r25),
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

export async function rollupCategories(periodType, from, to) {
  const p = periodExpr(periodType);

  const base = await chQuery(`
    SELECT toString(${p}) AS period_start, site, category, category_root,
           sum(pageviews)            AS pageviews,
           uniqMerge(visitors_state) AS unique_visitors,
           uniqMerge(articles_state) AS articles_viewed
      FROM pulse.category_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY period_start, site, category, category_root`, { from, to });

  if (!base.length) return 0;

  return bulkUpsert(
    'category_stats',
    ['site', 'category', 'category_root', 'period_type', 'period_start',
      'pageviews', 'unique_visitors', 'articles_published', 'avg_pageviews_per_article'],
    ['site', 'category', 'period_type', 'period_start'],
    base.map((r) => ({
      site: r.site,
      category: r.category,
      category_root: r.category_root,
      period_type: periodType,
      period_start: r.period_start,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
      articles_published: num(r.articles_viewed),
      avg_pageviews_per_article: round2(num(r.pageviews) / Math.max(1, num(r.articles_viewed))),
    })),
  );
}

export async function rollupTags(periodType, from, to) {
  const p = periodExpr(periodType);

  const rows = await chQuery(`
    SELECT toString(${p}) AS period_start, site, tag,
           sum(pageviews)            AS pageviews,
           uniqMerge(sessions_state) AS sessions,
           uniqMerge(articles_state) AS articles
      FROM pulse.tag_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY period_start, site, tag`, { from, to });

  if (!rows.length) return 0;

  return bulkUpsert(
    'tag_stats',
    ['site', 'tag', 'period_type', 'period_start', 'pageviews', 'unique_visitors', 'articles_count'],
    ['site', 'tag', 'period_type', 'period_start'],
    rows.map((r) => ({
      site: r.site,
      tag: r.tag,
      period_type: periodType,
      period_start: r.period_start,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.sessions),
      articles_count: num(r.articles),
    })),
    ['pageviews', 'unique_visitors', 'articles_count'],
  );
}

export async function rollupSources(periodType, from, to) {
  const p = periodExpr(periodType);

  const base = await chQuery(`
    SELECT toString(${p}) AS period_start, site, traffic_source, category_root,
           sum(pageviews)            AS pageviews,
           uniqMerge(visitors_state) AS unique_visitors
      FROM pulse.source_daily
     WHERE date BETWEEN {from:Date} AND {to:Date}
     GROUP BY period_start, site, traffic_source, category_root`, { from, to });

  if (!base.length) return 0;

  const sessions = await chQuery(`
    SELECT period_start, site, traffic_source, category_root,
           count()                           AS sessions,
           avg(pageviews)                    AS avg_pages,
           countIf(pageviews <= 1) / count() AS bounce,
           avg(active_time_ms) / 1000        AS avg_sec
      FROM (
        SELECT toString(${p}) AS period_start, site, session_id,
               sum(pageviews)           AS pageviews,
               sum(active_time_ms)      AS active_time_ms,
               any(traffic_source)      AS traffic_source,
               any(entry_category_root) AS category_root
          FROM pulse.sessions
         WHERE date BETWEEN {from:Date} AND {to:Date}
         GROUP BY period_start, site, session_id
      )
     GROUP BY period_start, site, traffic_source, category_root`, { from, to });

  const k = (r) => `${r.period_start}|${r.site}|${r.traffic_source}|${r.category_root}`;
  const sess = new Map(sessions.map((r) => [k(r), r]));

  return bulkUpsert(
    'source_stats',
    ['site', 'traffic_source', 'category_root', 'period_type', 'period_start',
      'pageviews', 'unique_visitors', 'sessions', 'avg_session_pages', 'bounce_rate', 'avg_session_sec'],
    ['site', 'traffic_source', 'category_root', 'period_type', 'period_start'],
    base.map((r) => {
      const s = sess.get(k(r)) ?? {};
      return {
        site: r.site,
        traffic_source: r.traffic_source,
        category_root: r.category_root || '',
        period_type: periodType,
        period_start: r.period_start,
        pageviews: num(r.pageviews),
        unique_visitors: num(r.unique_visitors),
        sessions: num(s.sessions),
        avg_session_pages: round2(s.avg_pages),
        bounce_rate: round2(num(s.bounce) * 100),
        avg_session_sec: round2(s.avg_sec),
      };
    }),
  );
}

export async function rollupAll(periodType, from, to) {
  return {
    authors: await rollupAuthors(periodType, from, to),
    categories: await rollupCategories(periodType, from, to),
    tags: await rollupTags(periodType, from, to),
    sources: await rollupSources(periodType, from, to),
  };
}
