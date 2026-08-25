/**
 * Overview ekran (sekcija 10.1) + real-time widget.
 *
 * Real-time ide direktno u ClickHouse (minute_pulse) - to je jedini izuzetak
 * od pravila "dashboard cita Postgres", jer 5-minutni cron ne moze da posluzi
 * widget koji se osvezava na 10 sekundi.
 */
import { chQuery, pgQuery, SOURCE_LABELS } from '@pulse/shared';
import { siteScope, authorScope, ROLES } from '../auth.js';
import { dateRange, trend, previousRange } from '../utils.js';
import { totalUniqueVisitors, uniqueVisitorsBySource } from '../uniques.js';

const num = (v) => Number(v ?? 0);

export default async function overviewRoutes(app) {
  const auth = { preHandler: [app.authenticate] };

  // ── Real-time: aktivni posetioci u poslednjih 5 minuta ───────────────────
  app.get('/realtime', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);

    const [active] = await chQuery(`
      SELECT uniqMerge(sessions_state) AS active_visitors,
             sum(pageviews)            AS pageviews_5m
        FROM pulse.minute_pulse
       WHERE site = {site:String} AND minute >= now() - INTERVAL 5 MINUTE`, { site });

    const perMinute = await chQuery(`
      SELECT formatDateTime(minute, '%H:%M')  AS minute,
             sum(pageviews)                   AS pageviews
        FROM pulse.minute_pulse
       WHERE site = {site:String} AND minute >= now() - INTERVAL 30 MINUTE
       GROUP BY minute ORDER BY minute`, { site });

    // Autor u real-time-u vidi samo svoje tekstove
    const authorFilter = req.user.role === ROLES.AUTHOR ? 'AND author = {author:String}' : '';
    const topArticles = await chQuery(`
      SELECT article_id,
             any(title)      AS title,
             any(author)     AS author,
             any(category)   AS category,
             count()         AS pageviews
        FROM pulse.events
       WHERE site = {site:String}
         AND event_type = 'pageview'
         AND is_bot = 0
         AND timestamp >= now() - INTERVAL 5 MINUTE
         AND article_id != ''
         ${authorFilter}
       GROUP BY article_id
       ORDER BY pageviews DESC
       LIMIT 10`, { site, author: req.user.authorSlug ?? '' });

    const byCategory = await chQuery(`
      SELECT category_root AS category, sum(pageviews) AS pageviews
        FROM pulse.minute_pulse
       WHERE site = {site:String} AND minute >= now() - INTERVAL 5 MINUTE
       GROUP BY category_root ORDER BY pageviews DESC LIMIT 8`, { site });

    return {
      activeVisitors: num(active?.active_visitors),
      pageviews5m: num(active?.pageviews_5m),
      perMinute: perMinute.map((r) => ({ minute: r.minute, pageviews: num(r.pageviews) })),
      topArticles: topArticles.map((r) => ({
        articleId: r.article_id,
        title: r.title || r.article_id,
        author: r.author,
        category: r.category,
        pageviews: num(r.pageviews),
      })),
      byCategory: byCategory.map((r) => ({ category: r.category || '(ostalo)', pageviews: num(r.pageviews) })),
    };
  });

  // ── Overview ─────────────────────────────────────────────────────────────
  app.get('/overview', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange(req.query);
    const prev = previousRange(from, to);
    const scope = authorScope(req.user, req.query.author);

    // Pregledi se sabiraju (aditivni su); jedinstveni posetioci NE - vidi uniques.js
    const totalsQuery = scope.author
      ? pgQuery(
        `SELECT coalesce(sum(pageviews),0) AS pageviews
           FROM author_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date AND author=$4`,
        [site, from, to, scope.author])
      : pgQuery(
        `SELECT coalesce(sum(pageviews),0) AS pageviews
           FROM source_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date`,
        [site, from, to]);

    const prevQuery = scope.author
      ? pgQuery(
        `SELECT coalesce(sum(pageviews),0) AS pageviews FROM author_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date AND author=$4`,
        [site, prev.from, prev.to, scope.author])
      : pgQuery(
        `SELECT coalesce(sum(pageviews),0) AS pageviews FROM source_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date`,
        [site, prev.from, prev.to]);

    const [totals, prevTotals, uniqueVisitors, uvBySource, sources, topArticles, activeSpike] = await Promise.all([
      totalsQuery,
      prevQuery,
      totalUniqueVisitors(site, from, to),
      uniqueVisitorsBySource(site, from, to),
      pgQuery(
        `SELECT traffic_source, sum(pageviews) AS pageviews,
                round(avg(nullif(bounce_rate,0))::numeric,1) AS bounce_rate
           FROM source_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          GROUP BY traffic_source ORDER BY pageviews DESC`,
        [site, from, to]),
      pgQuery(
        `SELECT article_id, title, author, category, pageviews_24h, pageviews_total, trending_score
           FROM article_stats
          WHERE site=$1 ${scope.author ? 'AND author=$2' : ''}
          ORDER BY pageviews_24h DESC LIMIT 10`,
        scope.author ? [site, scope.author] : [site]),
      pgQuery(
        `SELECT * FROM spike_alerts
          WHERE site=$1 AND detected_at > now() - INTERVAL '30 minutes' AND resolved_at IS NULL
          ORDER BY detected_at DESC LIMIT 1`,
        [site]),
    ]);

    // Grafik: danas vs isti dan prosle nedelje (sekcija 10.1)
    const hourly = await pgQuery(
      `SELECT to_char(hour_utc, 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour_utc,
              extract(hour from hour_utc)::int AS hour,
              pageviews,
              CASE WHEN hour_utc >= date_trunc('day', now()) THEN 'today' ELSE 'last_week' END AS series
         FROM hourly_traffic
        WHERE site=$1 AND category_root=''
          AND (hour_utc >= date_trunc('day', now())
               OR (hour_utc >= date_trunc('day', now()) - INTERVAL '7 days'
                   AND hour_utc <  date_trunc('day', now()) - INTERVAL '6 days'))
        ORDER BY hour_utc`,
      [site],
    );

    const todaySeries = new Array(24).fill(0);
    const lastWeekSeries = new Array(24).fill(0);
    for (const r of hourly) {
      const target = r.series === 'today' ? todaySeries : lastWeekSeries;
      target[r.hour] = num(r.pageviews);
    }

    const totalPageviews = num(totals[0]?.pageviews);

    return {
      site,
      range: { from, to },
      totals: {
        pageviews: totalPageviews,
        uniqueVisitors,
        trendPct: trend(totalPageviews, num(prevTotals[0]?.pageviews)),
      },
      sources: sources.map((s) => ({
        source: s.traffic_source,
        label: SOURCE_LABELS[s.traffic_source] ?? s.traffic_source,
        pageviews: num(s.pageviews),
        uniqueVisitors: uvBySource.get(s.traffic_source) ?? 0,
        bounceRate: num(s.bounce_rate),
        share: totalPageviews > 0 ? Math.round((num(s.pageviews) / totalPageviews) * 1000) / 10 : 0,
      })),
      hourly: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        today: todaySeries[h],
        lastWeek: lastWeekSeries[h],
      })),
      topArticles: topArticles.map((a) => ({
        articleId: a.article_id,
        title: a.title ?? a.article_id,
        author: a.author,
        category: a.category,
        pageviews24h: num(a.pageviews_24h),
        pageviewsTotal: num(a.pageviews_total),
        trendingScore: num(a.trending_score),
      })),
      spike: activeSpike[0]
        ? {
          detectedAt: activeSpike[0].detected_at,
          pageviewsPerMin: num(activeSpike[0].pageviews_per_min),
          multiplier: num(activeSpike[0].multiplier),
          driverType: activeSpike[0].driver_type,
          driverValue: activeSpike[0].driver_value,
        }
        : null,
    };
  });

  // ── Spike alerti (sekcija 9.4) ───────────────────────────────────────────
  app.get('/alerts', { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] }, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const alerts = await pgQuery(
      `SELECT * FROM spike_alerts WHERE site=$1 ORDER BY detected_at DESC LIMIT 100`,
      [site],
    );
    return { alerts };
  });

  app.post('/alerts/:id/resolve', { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] }, async (req, reply) => {
    const rows = await pgQuery(
      'UPDATE spike_alerts SET resolved_at = now() WHERE id = $1 RETURNING id',
      [Number(req.params.id)],
    );
    if (!rows.length) return reply.code(404).send({ error: 'Alert ne postoji' });
    return { ok: true };
  });

  // ── Zdravlje pipeline-a (za admin ekran) ─────────────────────────────────
  app.get('/system/health', { preHandler: [app.requireRole(ROLES.ADMIN)] }, async () => {
    const jobs = await pgQuery(
      `SELECT DISTINCT ON (job_name) job_name, status, rows_written, started_at, finished_at, error
         FROM job_runs ORDER BY job_name, started_at DESC`,
    );
    const [chStats] = await chQuery(`
      SELECT count() AS events_24h, uniq(session_id) AS sessions_24h, countIf(is_bot = 1) AS bots_24h
        FROM pulse.events WHERE timestamp >= now() - INTERVAL 24 HOUR`);

    return {
      jobs,
      clickhouse: {
        events24h: num(chStats?.events_24h),
        sessions24h: num(chStats?.sessions_24h),
        bots24h: num(chStats?.bots_24h),
      },
    };
  });
}
