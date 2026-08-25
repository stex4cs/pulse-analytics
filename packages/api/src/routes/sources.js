/**
 * Traffic sources ekran (sekcija 10.5).
 *
 * Google Discover ima svoj grafik jer se ponasa drugacije od organic-a
 * (sekcija 5.3), a "direct" nosi napomenu iz sekcije 5.2.
 */
import { pgQuery, SOURCE_LABELS } from '@pulse/shared';
import { siteScope, ROLES } from '../auth.js';
import { dateRange, limit, trend, previousRange, toCsv } from '../utils.js';
import { uniqueVisitorsBySource } from '../uniques.js';

const num = (v) => Number(v ?? 0);

const DIRECT_NOTE = 'Direktan saobraćaj je često "lažan": dolazi iz aplikacija (Viber, WhatsApp), '
  + 'email klijenata ili se referrer izgubi na HTTPS→HTTP prelazu. Tagujte newsletter i app '
  + 'deep linkove UTM parametrima da bi ovaj broj bio manji i tačniji.';

export default async function sourceRoutes(app) {
  const staff = { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] };

  // ── Pregled po kanalu ────────────────────────────────────────────────────
  app.get('/sources', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 7, ...req.query });
    const prev = previousRange(from, to);

    // unique_visitors se ne sabira preko dana - dolazi iz uniqMerge (uniques.js)
    const [rows, previous, uvBySource] = await Promise.all([
      pgQuery(
        `SELECT traffic_source,
                sum(pageviews)       AS pageviews,
                sum(sessions)        AS sessions,
                round((sum(pageviews)::numeric / nullif(sum(sessions),0)), 2) AS avg_session_pages,
                round(avg(nullif(bounce_rate,0))::numeric, 1)      AS bounce_rate,
                round(avg(nullif(avg_session_sec,0))::numeric, 1)  AS avg_session_sec
           FROM source_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          GROUP BY traffic_source ORDER BY pageviews DESC`,
        [site, from, to]),
      pgQuery(
        `SELECT traffic_source, sum(pageviews) AS pageviews
           FROM source_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          GROUP BY traffic_source`,
        [site, prev.from, prev.to]),
      uniqueVisitorsBySource(site, from, to),
    ]);

    const prevMap = new Map(previous.map((r) => [r.traffic_source, num(r.pageviews)]));
    const total = rows.reduce((s, r) => s + num(r.pageviews), 0);

    return {
      range: { from, to },
      total,
      directNote: DIRECT_NOTE,
      sources: rows.map((r) => ({
        source: r.traffic_source,
        label: SOURCE_LABELS[r.traffic_source] ?? r.traffic_source,
        pageviews: num(r.pageviews),
        uniqueVisitors: uvBySource.get(r.traffic_source) ?? 0,
        sessions: num(r.sessions),
        avgSessionPages: num(r.avg_session_pages),
        bounceRate: num(r.bounce_rate),
        avgSessionSec: num(r.avg_session_sec),
        share: total > 0 ? Math.round((num(r.pageviews) / total) * 1000) / 10 : 0,
        trendPct: trend(num(r.pageviews), prevMap.get(r.traffic_source) ?? 0),
      })),
    };
  });

  // ── Trend kroz vreme po kanalu ───────────────────────────────────────────
  app.get('/sources/timeseries', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });

    const rows = await pgQuery(
      `SELECT to_char(period_start,'YYYY-MM-DD') AS date, traffic_source, sum(pageviews) AS pageviews
         FROM source_stats
        WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
        GROUP BY period_start, traffic_source ORDER BY period_start`,
      [site, from, to],
    );

    const dates = [...new Set(rows.map((r) => r.date))];
    const sources = [...new Set(rows.map((r) => r.traffic_source))];
    const index = new Map(rows.map((r) => [`${r.date}|${r.traffic_source}`, num(r.pageviews)]));

    return {
      range: { from, to },
      sources: sources.map((s) => ({ source: s, label: SOURCE_LABELS[s] ?? s })),
      points: dates.map((date) => {
        const point = { date };
        for (const s of sources) point[s] = index.get(`${date}|${s}`) ?? 0;
        return point;
      }),
    };
  });

  // ── Google Discover izdvojeno (sekcija 5.3 / 10.5) ───────────────────────
  app.get('/sources/discover', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });

    const [series, topArticles, comparison] = await Promise.all([
      pgQuery(
        `SELECT to_char(period_start,'YYYY-MM-DD') AS date,
                sum(pageviews) AS pageviews, sum(sessions) AS sessions,
                round(avg(nullif(bounce_rate,0))::numeric,1) AS bounce_rate,
                round(avg(nullif(avg_session_sec,0))::numeric,1) AS avg_session_sec
           FROM source_stats
          WHERE site=$1 AND traffic_source='google_discover' AND period_type='day'
            AND period_start BETWEEN $2::date AND $3::date
          GROUP BY period_start ORDER BY period_start`,
        [site, from, to]),
      pgQuery(
        `SELECT article_id, title, author, category,
                (source_breakdown->>'google_discover')::bigint AS discover_pageviews,
                pageviews_total
           FROM article_stats
          WHERE site=$1 AND source_breakdown ? 'google_discover'
          ORDER BY (source_breakdown->>'google_discover')::bigint DESC NULLS LAST
          LIMIT 20`,
        [site]),
      pgQuery(
        `SELECT traffic_source,
                round(avg(nullif(bounce_rate,0))::numeric,1)     AS bounce_rate,
                round(avg(nullif(avg_session_pages,0))::numeric,2) AS avg_session_pages,
                round(avg(nullif(avg_session_sec,0))::numeric,1)  AS avg_session_sec
           FROM source_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
            AND traffic_source IN ('google_discover','search_organic','social_meta','direct')
          GROUP BY traffic_source`,
        [site, from, to]),
    ]);

    return {
      range: { from, to },
      series: series.map((r) => ({
        date: r.date,
        pageviews: num(r.pageviews),
        sessions: num(r.sessions),
        bounceRate: num(r.bounce_rate),
        avgSessionSec: num(r.avg_session_sec),
      })),
      topArticles: topArticles.map((a) => ({
        articleId: a.article_id,
        title: a.title ?? a.article_id,
        author: a.author,
        category: a.category,
        discoverPageviews: num(a.discover_pageviews),
        pageviewsTotal: num(a.pageviews_total),
        discoverShare: num(a.pageviews_total) > 0
          ? Math.round((num(a.discover_pageviews) / num(a.pageviews_total)) * 1000) / 10
          : 0,
      })),
      comparison: comparison.map((c) => ({
        source: c.traffic_source,
        label: SOURCE_LABELS[c.traffic_source] ?? c.traffic_source,
        bounceRate: num(c.bounce_rate),
        avgSessionPages: num(c.avg_session_pages),
        avgSessionSec: num(c.avg_session_sec),
      })),
      note: 'Discover dolazi u talasima, sa kratkim sesijama i visokim bounce-om. '
        + 'Poređenje sa organskom pretragom pokazuje zašto se ova dva kanala ne smeju mešati.',
    };
  });

  // ── Presek kanal x device ────────────────────────────────────────────────
  app.get('/sources/devices', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 7, ...req.query });

    const rows = await pgQuery(
      `SELECT traffic_source, device_type, sum(pageviews) AS pageviews
         FROM source_device_stats
        WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
        GROUP BY traffic_source, device_type`,
      [site, from, to],
    );

    const devices = [...new Set(rows.map((r) => r.device_type))];
    const matrix = new Map();
    for (const r of rows) {
      if (!matrix.has(r.traffic_source)) matrix.set(r.traffic_source, {});
      matrix.get(r.traffic_source)[r.device_type] = num(r.pageviews);
    }

    return {
      range: { from, to },
      devices,
      rows: [...matrix].map(([source, byDevice]) => {
        const total = Object.values(byDevice).reduce((a, b) => a + b, 0);
        return {
          source,
          label: SOURCE_LABELS[source] ?? source,
          total,
          byDevice,
          shares: Object.fromEntries(Object.entries(byDevice)
            .map(([d, v]) => [d, total > 0 ? Math.round((v / total) * 1000) / 10 : 0])),
        };
      }).sort((a, b) => b.total - a.total),
    };
  });

  // ── UTM kampanje (paid) ──────────────────────────────────────────────────
  app.get('/sources/campaigns', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });

    const rows = await pgQuery(
      `SELECT utm_source, utm_medium, utm_campaign,
              sum(pageviews) AS pageviews, sum(sessions) AS sessions
         FROM campaign_stats
        WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
        GROUP BY utm_source, utm_medium, utm_campaign
        ORDER BY pageviews DESC LIMIT ${limit(req.query, 100)}`,
      [site, from, to],
    );

    return {
      range: { from, to },
      campaigns: rows.map((r) => ({
        utmSource: r.utm_source,
        utmMedium: r.utm_medium,
        utmCampaign: r.utm_campaign,
        pageviews: num(r.pageviews),
        sessions: num(r.sessions),
        pagesPerSession: num(r.sessions) > 0 ? Math.round((num(r.pageviews) / num(r.sessions)) * 100) / 100 : 0,
      })),
    };
  });

  app.get('/sources/export.csv', staff, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });

    const rows = await pgQuery(
      `SELECT to_char(period_start,'YYYY-MM-DD') AS date, traffic_source, category_root,
              pageviews, unique_visitors, sessions, avg_session_pages, bounce_rate
         FROM source_stats
        WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
        ORDER BY period_start DESC, pageviews DESC`,
      [site, from, to],
    );

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="pulse-kanali-${from}_${to}.csv"`);
    return toCsv(rows);
  });
}
