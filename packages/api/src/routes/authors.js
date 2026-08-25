/**
 * Autori (sekcija 10.2) i author leaderboard (sekcija 9.5).
 *
 * Role-based: ako je ulogovan role=author, sve rute ovde vracaju samo njega.
 */
import { pgQuery, pgQueryOne, SOURCE_LABELS } from '@pulse/shared';
import { siteScope, authorScope, ROLES } from '../auth.js';
import { dateRange, periodType, limit, orderBy, trend, previousRange, toCsv } from '../utils.js';
import { uniqueVisitorsByAuthor } from '../uniques.js';

const num = (v) => Number(v ?? 0);

// Bez 'unique_visitors': ne racuna se u ovom upitu (dolazi iz uniqMerge),
// pa ne postoji kao kolona po kojoj bi Postgres mogao da sortira.
const SORTABLE = [
  'pageviews', 'articles_published',
  'read_completion_rate', 'avg_time_on_page_sec', 'author',
];

async function leaderboard(site, from, to, scope, query) {
  const params = [site, from, to];
  let authorFilter = '';
  if (scope.author) {
    params.push(scope.author);
    authorFilter = `AND author = $${params.length}`;
  }

  const rows = await pgQuery(
    `SELECT author,
            sum(pageviews)                                      AS pageviews,
            sum(articles_published)                             AS articles_published,
            round(avg(nullif(avg_time_on_page_sec,0))::numeric, 1)   AS avg_time_on_page_sec,
            round(avg(nullif(avg_scroll_completion,0))::numeric, 1)  AS avg_scroll_completion,
            round(avg(nullif(read_completion_rate,0))::numeric, 1)   AS read_completion_rate
       FROM author_stats
      WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date ${authorFilter}
      GROUP BY author
      HAVING sum(pageviews) > 0
      ORDER BY ${orderBy(query, SORTABLE, 'pageviews')}
      LIMIT ${limit(query, 100)}`,
    params,
  );
  return rows;
}

export default async function authorRoutes(app) {
  const auth = { preHandler: [app.authenticate] };

  // ── Tabela autora ────────────────────────────────────────────────────────
  app.get('/authors', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 7, ...req.query });
    const prev = previousRange(from, to);
    const scope = authorScope(req.user, req.query.author);

    // unique_visitors ne sme da se sabira preko dana (sekcija 15.3) - vidi uniques.js
    const [current, previous, uvByAuthor] = await Promise.all([
      leaderboard(site, from, to, scope, req.query),
      pgQuery(
        `SELECT author, sum(pageviews) AS pageviews
           FROM author_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          GROUP BY author`,
        [site, prev.from, prev.to]),
      uniqueVisitorsByAuthor(site, from, to),
    ]);

    const prevMap = new Map(previous.map((r) => [r.author, num(r.pageviews)]));

    return {
      range: { from, to },
      authors: current.map((r) => ({
        author: r.author,
        pageviews: num(r.pageviews),
        uniqueVisitors: uvByAuthor.get(r.author) ?? 0,
        articlesPublished: num(r.articles_published),
        avgPageviewsPerArticle: num(r.articles_published) > 0
          ? Math.round(num(r.pageviews) / num(r.articles_published))
          : num(r.pageviews),
        avgTimeOnPageSec: num(r.avg_time_on_page_sec),
        avgScrollCompletion: num(r.avg_scroll_completion),
        readCompletionRate: num(r.read_completion_rate),
        trendPct: trend(num(r.pageviews), prevMap.get(r.author) ?? 0),
      })),
    };
  });

  // ── Detalj autora ────────────────────────────────────────────────────────
  app.get('/authors/:slug', auth, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const scope = authorScope(req.user, req.params.slug);
    const author = scope.author;

    if (!author) return reply.code(400).send({ error: 'Autor nije naveden' });

    const [totals, series, topArticles, byCategory, sourceRows, uvByAuthor] = await Promise.all([
      pgQueryOne(
        `SELECT sum(pageviews) AS pageviews,
                sum(articles_published) AS articles_published,
                round(avg(nullif(read_completion_rate,0))::numeric,1) AS read_completion_rate,
                round(avg(nullif(avg_time_on_page_sec,0))::numeric,1) AS avg_time_on_page_sec
           FROM author_stats
          WHERE site=$1 AND author=$2 AND period_type='day' AND period_start BETWEEN $3::date AND $4::date`,
        [site, author, from, to]),
      pgQuery(
        `SELECT to_char(period_start,'YYYY-MM-DD') AS date, pageviews, unique_visitors
           FROM author_stats
          WHERE site=$1 AND author=$2 AND period_type='day' AND period_start BETWEEN $3::date AND $4::date
          ORDER BY period_start`,
        [site, author, from, to]),
      pgQuery(
        `SELECT article_id, title, category, published_at, pageviews_total, pageviews_7d,
                read_completion_rate, avg_time_on_page_sec
           FROM article_stats
          WHERE site=$1 AND author=$2
          ORDER BY pageviews_total DESC LIMIT 20`,
        [site, author]),
      pgQuery(
        `SELECT category, sum(pageviews_total) AS pageviews, count(*)::int AS articles
           FROM article_stats
          WHERE site=$1 AND author=$2 AND category IS NOT NULL
          GROUP BY category ORDER BY pageviews DESC LIMIT 15`,
        [site, author]),
      pgQuery(
        `SELECT source_breakdown FROM author_stats
          WHERE site=$1 AND author=$2 AND period_type='day' AND period_start BETWEEN $3::date AND $4::date`,
        [site, author, from, to]),
      uniqueVisitorsByAuthor(site, from, to),
    ]);

    // Kanali se sabiraju iz dnevnih JSONB razrada
    const channels = {};
    for (const row of sourceRows) {
      for (const [source, pv] of Object.entries(row.source_breakdown ?? {})) {
        channels[source] = (channels[source] ?? 0) + num(pv);
      }
    }

    return {
      author,
      range: { from, to },
      totals: {
        pageviews: num(totals?.pageviews),
        uniqueVisitors: uvByAuthor.get(author) ?? 0,
        articlesPublished: num(totals?.articles_published),
        readCompletionRate: num(totals?.read_completion_rate),
        avgTimeOnPageSec: num(totals?.avg_time_on_page_sec),
      },
      series: series.map((r) => ({ date: r.date, pageviews: num(r.pageviews), uniqueVisitors: num(r.unique_visitors) })),
      topArticles: topArticles.map((a) => ({
        articleId: a.article_id,
        title: a.title ?? a.article_id,
        category: a.category,
        publishedAt: a.published_at,
        pageviewsTotal: num(a.pageviews_total),
        pageviews7d: num(a.pageviews_7d),
        readCompletionRate: num(a.read_completion_rate),
        avgTimeOnPageSec: num(a.avg_time_on_page_sec),
      })),
      byCategory: byCategory.map((c) => ({ category: c.category, pageviews: num(c.pageviews), articles: c.articles })),
      byChannel: Object.entries(channels)
        .map(([source, pageviews]) => ({ source, label: SOURCE_LABELS[source] ?? source, pageviews }))
        .sort((a, b) => b.pageviews - a.pageviews),
    };
  });

  // ── CSV export (sekcija 10.7) ────────────────────────────────────────────
  app.get('/authors/export.csv', auth, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const scope = authorScope(req.user, req.query.author);
    const rows = await leaderboard(site, from, to, scope, { ...req.query, limit: 500 });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="pulse-autori-${from}_${to}.csv"`);
    const uv = await uniqueVisitorsByAuthor(site, from, to);
    const withUniques = rows.map((r) => ({ ...r, unique_visitors: uv.get(r.author) ?? 0 }));

    return toCsv(withUniques, ['author', 'pageviews', 'unique_visitors', 'articles_published',
      'avg_time_on_page_sec', 'avg_scroll_completion', 'read_completion_rate']);
  });

  // ── Period rollup (nedelja / mesec) ──────────────────────────────────────
  app.get('/authors/periods', { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] }, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const period = periodType(req.query);
    const rows = await pgQuery(
      `SELECT author, to_char(period_start,'YYYY-MM-DD') AS period_start,
              pageviews, unique_visitors, articles_published, read_completion_rate
         FROM author_stats
        WHERE site=$1 AND period_type=$2
        ORDER BY period_start DESC, pageviews DESC
        LIMIT ${limit(req.query, 200, 1000)}`,
      [site, period],
    );
    return { period, rows };
  });
}
