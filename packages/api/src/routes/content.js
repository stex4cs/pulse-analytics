/**
 * Kategorije (10.3), Tagovi (10.4) i Clanak detail (10.6).
 */
import { chQuery, pgQuery, pgQueryOne, SOURCE_LABELS, percentileOf } from '@pulse/shared';
import { siteScope, authorScope, ROLES } from '../auth.js';
import { dateRange, limit, orderBy, trend, previousRange, toCsv } from '../utils.js';
import { uniqueVisitorsByCategory, uniqueVisitorsByTag } from '../uniques.js';

const num = (v) => Number(v ?? 0);

export default async function contentRoutes(app) {
  const auth = { preHandler: [app.authenticate] };
  const staff = { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] };

  // ══ KATEGORIJE ════════════════════════════════════════════════════════════

  /** Nivo 1: korenske kategorije. Sa ?root=fudbal se spusta nivo nize. */
  app.get('/categories', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 7, ...req.query });
    const prev = previousRange(from, to);
    const root = req.query.root ? String(req.query.root) : null;

    const params = [site, from, to];
    let filter = '';
    let groupCol = 'category_root';

    if (root) {
      params.push(root);
      filter = `AND category_root = $${params.length}`;
      groupCol = 'category';
    }

    // unique_visitors dolazi iz uniqMerge, ne iz zbira dnevnih redova (sekcija 15.3)
    const [rows, previous, uvByCategory] = await Promise.all([
      pgQuery(
        `SELECT ${groupCol} AS category,
                sum(pageviews)          AS pageviews,
                sum(articles_published) AS articles_published,
                round(avg(nullif(read_completion_rate,0))::numeric,1) AS read_completion_rate,
                round(avg(nullif(avg_time_on_page_sec,0))::numeric,1) AS avg_time_on_page_sec
           FROM category_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date ${filter}
          GROUP BY ${groupCol}
          ORDER BY ${orderBy(req.query, ['pageviews', 'articles_published'], 'pageviews')}
          LIMIT ${limit(req.query, 100)}`,
        params),
      pgQuery(
        `SELECT ${groupCol} AS category, sum(pageviews) AS pageviews
           FROM category_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
                ${root ? `AND category_root = $4` : ''}
          GROUP BY ${groupCol}`,
        root ? [site, prev.from, prev.to, root] : [site, prev.from, prev.to]),
      uniqueVisitorsByCategory(site, from, to, { root: !root }),
    ]);

    const prevMap = new Map(previous.map((r) => [r.category, num(r.pageviews)]));

    return {
      root,
      range: { from, to },
      categories: rows.map((r) => ({
        category: r.category,
        pageviews: num(r.pageviews),
        uniqueVisitors: uvByCategory.get(r.category) ?? 0,
        articlesPublished: num(r.articles_published),
        readCompletionRate: num(r.read_completion_rate),
        avgTimeOnPageSec: num(r.avg_time_on_page_sec),
        trendPct: trend(num(r.pageviews), prevMap.get(r.category) ?? 0),
      })),
    };
  });

  /** Poredjenje vise kategorija na jednom grafiku (multi-select iz 10.3). */
  app.get('/categories/compare', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const names = String(req.query.categories ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);

    if (!names.length) return { series: [] };

    const rows = await pgQuery(
      `SELECT category, to_char(period_start,'YYYY-MM-DD') AS date, sum(pageviews) AS pageviews
         FROM category_stats
        WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          AND category = ANY($4)
        GROUP BY category, period_start ORDER BY period_start`,
      [site, from, to, names],
    );

    const byCategory = new Map(names.map((n) => [n, []]));
    for (const r of rows) {
      byCategory.get(r.category)?.push({ date: r.date, pageviews: num(r.pageviews) });
    }
    return { range: { from, to }, series: [...byCategory].map(([category, points]) => ({ category, points })) };
  });

  /** Kanal breakdown po kategoriji - kljucni insight iz 10.3. */
  app.get('/categories/channels', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 7, ...req.query });

    const rows = await pgQuery(
      `SELECT category_root, traffic_source, sum(pageviews) AS pageviews
         FROM source_stats
        WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          AND category_root <> ''
        GROUP BY category_root, traffic_source`,
      [site, from, to],
    );

    const matrix = new Map();
    const sources = new Set();
    for (const r of rows) {
      sources.add(r.traffic_source);
      if (!matrix.has(r.category_root)) matrix.set(r.category_root, {});
      matrix.get(r.category_root)[r.traffic_source] = num(r.pageviews);
    }

    return {
      range: { from, to },
      sources: [...sources].map((s) => ({ source: s, label: SOURCE_LABELS[s] ?? s })),
      rows: [...matrix].map(([category, byS]) => {
        const total = Object.values(byS).reduce((a, b) => a + b, 0);
        return {
          category,
          total,
          bySource: byS,
          shares: Object.fromEntries(Object.entries(byS)
            .map(([s, v]) => [s, total > 0 ? Math.round((v / total) * 1000) / 10 : 0])),
        };
      }).sort((a, b) => b.total - a.total),
    };
  });

  // ══ TAGOVI ════════════════════════════════════════════════════════════════

  /** Trending tagovi u poslednja 24h (sekcija 10.4). */
  app.get('/tags/trending', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const rows = await pgQuery(
      `SELECT tag, pageviews, unique_visitors, articles_count, trending_score
         FROM tag_stats
        WHERE site=$1 AND period_type='day' AND period_start >= current_date - 1
          AND trending_score > 0
        ORDER BY trending_score DESC LIMIT ${limit(req.query, 25)}`,
      [site],
    );
    return {
      tags: rows.map((r) => ({
        tag: r.tag,
        pageviews: num(r.pageviews),
        uniqueVisitors: num(r.unique_visitors),
        articles: num(r.articles_count),
        trendingScore: num(r.trending_score),
      })),
    };
  });

  app.get('/tags', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const [rows, uvByTag] = await Promise.all([
      pgQuery(
        `SELECT tag, sum(pageviews) AS pageviews,
                max(articles_count) AS articles_count, max(trending_score) AS trending_score
           FROM tag_stats
          WHERE site=$1 AND period_type='day' AND period_start BETWEEN $2::date AND $3::date
          GROUP BY tag
          ORDER BY ${orderBy(req.query, ['pageviews', 'trending_score'], 'pageviews')}
          LIMIT ${limit(req.query, 100)}`,
        [site, from, to]),
      uniqueVisitorsByTag(site, from, to),
    ]);
    return {
      range: { from, to },
      tags: rows.map((r) => ({
        tag: r.tag,
        pageviews: num(r.pageviews),
        uniqueVisitors: uvByTag.get(r.tag) ?? 0,
        articles: num(r.articles_count),
        trendingScore: num(r.trending_score),
      })),
    };
  });

  app.get('/tags/:tag', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const tag = String(req.params.tag);

    const [series, articles, totals, uvByTag] = await Promise.all([
      pgQuery(
        `SELECT to_char(period_start,'YYYY-MM-DD') AS date, pageviews
           FROM tag_stats
          WHERE site=$1 AND tag=$2 AND period_type='day' AND period_start BETWEEN $3::date AND $4::date
          ORDER BY period_start`,
        [site, tag, from, to]),
      pgQuery(
        `SELECT article_id, title, author, category, published_at, pageviews_total, pageviews_7d
           FROM article_stats
          WHERE site=$1 AND $2 = ANY(tags)
          ORDER BY pageviews_total DESC LIMIT 50`,
        [site, tag]),
      pgQueryOne(
        `SELECT sum(pageviews) AS pageviews
           FROM tag_stats
          WHERE site=$1 AND tag=$2 AND period_type='day' AND period_start BETWEEN $3::date AND $4::date`,
        [site, tag, from, to]),
      uniqueVisitorsByTag(site, from, to),
    ]);

    return {
      tag,
      range: { from, to },
      totals: { pageviews: num(totals?.pageviews), uniqueVisitors: uvByTag.get(tag) ?? 0 },
      series: series.map((r) => ({ date: r.date, pageviews: num(r.pageviews) })),
      articles: articles.map((a) => ({
        articleId: a.article_id,
        title: a.title ?? a.article_id,
        author: a.author,
        category: a.category,
        publishedAt: a.published_at,
        pageviewsTotal: num(a.pageviews_total),
        pageviews7d: num(a.pageviews_7d),
      })),
    };
  });

  // ══ CLANCI ════════════════════════════════════════════════════════════════

  app.get('/articles', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const scope = authorScope(req.user, req.query.author);

    const params = [site];
    const where = ['site = $1'];

    if (scope.author) { params.push(scope.author); where.push(`author = $${params.length}`); }
    if (req.query.category) { params.push(String(req.query.category)); where.push(`category LIKE $${params.length} || '%'`); }
    if (req.query.contentType) { params.push(String(req.query.contentType)); where.push(`content_type = $${params.length}`); }
    if (req.query.q) { params.push(`%${String(req.query.q)}%`); where.push(`title ILIKE $${params.length}`); }

    const rows = await pgQuery(
      `SELECT article_id, title, author, category, content_type, published_at,
              pageviews_total, pageviews_24h, pageviews_7d, unique_visitors,
              avg_time_on_page_sec, read_completion_rate, trending_score
         FROM article_stats
        WHERE ${where.join(' AND ')}
        ORDER BY ${orderBy(req.query, ['pageviews_total', 'pageviews_24h', 'pageviews_7d',
    'read_completion_rate', 'trending_score', 'published_at'], 'pageviews_24h')}
        LIMIT ${limit(req.query, 50, 500)}`,
      params,
    );

    return {
      articles: rows.map((a) => ({
        articleId: a.article_id,
        title: a.title ?? a.article_id,
        author: a.author,
        category: a.category,
        contentType: a.content_type,
        publishedAt: a.published_at,
        pageviewsTotal: num(a.pageviews_total),
        pageviews24h: num(a.pageviews_24h),
        pageviews7d: num(a.pageviews_7d),
        uniqueVisitors: num(a.unique_visitors),
        avgTimeOnPageSec: num(a.avg_time_on_page_sec),
        readCompletionRate: num(a.read_completion_rate),
        trendingScore: num(a.trending_score),
      })),
    };
  });

  /** Clanak detail (sekcija 10.6). */
  app.get('/articles/:id', auth, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const articleId = String(req.params.id);

    const article = await pgQueryOne(
      'SELECT * FROM article_stats WHERE site=$1 AND article_id=$2',
      [site, articleId],
    );
    if (!article) return reply.code(404).send({ error: 'Članak ne postoji u statistici' });

    // Autor sme da vidi samo svoje tekstove
    authorScope(req.user, article.author);

    // Krivа pregleda od objave
    // Isti razlog kao u /realtime: alias ne sme da nosi ime kolone.
    const series = await chQuery(`
      SELECT formatDateTime(hour, '%Y-%m-%dT%H:00:00Z') AS label, sum(pageviews) AS pageviews
        FROM pulse.article_hourly
       WHERE site = {site:String} AND article_id = {id:String}
       GROUP BY hour ORDER BY hour`, { site, id: articleId });

    // "Kako se poredi" - percentil u odnosu na kategoriju (sekcija 10.6)
    const peers = await pgQuery(
      `SELECT pageviews_total FROM article_stats
        WHERE site=$1 AND category_root=$2 AND published_at > now() - INTERVAL '90 days'
        ORDER BY pageviews_total ASC`,
      [site, article.category_root],
    );
    const peerValues = peers.map((p) => num(p.pageviews_total));
    const categoryMedian = peerValues.length ? peerValues[Math.floor(peerValues.length / 2)] : 0;

    const abTest = await pgQueryOne(
      `SELECT t.test_id, t.status, t.winner_variant, t.min_impressions,
              json_agg(json_build_object(
                'variant', v.variant, 'headline', v.headline, 'isControl', v.is_control,
                'impressions', coalesce(r.impressions,0), 'clicks', coalesce(r.clicks,0),
                'ctr', r.ctr, 'confidence', r.confidence, 'isSignificant', coalesce(r.is_significant,false)
              ) ORDER BY v.variant) AS variants
         FROM ab_tests t
         JOIN ab_variants v ON v.test_id = t.test_id
         LEFT JOIN ab_results r ON r.test_id = t.test_id AND r.variant = v.variant
        WHERE t.site=$1 AND t.article_id=$2
        GROUP BY t.id
        ORDER BY t.created_at DESC LIMIT 1`,
      [site, articleId],
    );

    const funnel = article.scroll_funnel ?? {};
    const base = num(funnel.p25) || 1;

    return {
      article: {
        articleId: article.article_id,
        title: article.title ?? article.article_id,
        url: article.url,
        author: article.author,
        category: article.category,
        categoryRoot: article.category_root,
        contentType: article.content_type,
        tags: article.tags ?? [],
        wordCount: num(article.word_count),
        publishedAt: article.published_at,
        pageviewsTotal: num(article.pageviews_total),
        pageviews24h: num(article.pageviews_24h),
        pageviews7d: num(article.pageviews_7d),
        uniqueVisitors: num(article.unique_visitors),
        avgTimeOnPageSec: num(article.avg_time_on_page_sec),
        readCompletionRate: num(article.read_completion_rate),
        trendingScore: num(article.trending_score),
      },
      series: series.map((r) => ({ hour: r.label, pageviews: num(r.pageviews) })),
      sourceBreakdown: Object.entries(article.source_breakdown ?? {})
        .map(([source, pageviews]) => ({ source, label: SOURCE_LABELS[source] ?? source, pageviews: num(pageviews) }))
        .sort((a, b) => b.pageviews - a.pageviews),
      scrollFunnel: [
        { depth: 25, users: num(funnel.p25), pct: 100 },
        { depth: 50, users: num(funnel.p50), pct: Math.round((num(funnel.p50) / base) * 100) },
        { depth: 75, users: num(funnel.p75), pct: Math.round((num(funnel.p75) / base) * 100) },
        { depth: 100, users: num(funnel.p100), pct: Math.round((num(funnel.p100) / base) * 100) },
      ],
      comparison: {
        categoryPercentile: percentileOf(num(article.pageviews_total), peerValues),
        categoryMedian,
        peersCount: peerValues.length,
      },
      abTest,
    };
  });

  /** Heatmapa klikova (sekcija 9.1) - samo za clanke sa >500 pregleda. */
  app.get('/articles/:id/heatmap', staff, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const articleId = String(req.params.id);
    const bucket = Number(req.query.viewport) || 375;

    const article = await pgQueryOne(
      'SELECT pageviews_total FROM article_stats WHERE site=$1 AND article_id=$2',
      [site, articleId],
    );
    if (!article) return reply.code(404).send({ error: 'Članak ne postoji' });

    // Ispod 500 pregleda je sum, ne heatmapa (sekcija 9.1)
    if (num(article.pageviews_total) < 500) {
      return {
        available: false,
        reason: 'insufficient_data',
        pageviews: num(article.pageviews_total),
        required: 500,
      };
    }

    const cells = await chQuery(`
      SELECT x_cell, y_cell, sum(clicks) AS clicks
        FROM pulse.heatmap_clicks
       WHERE site = {site:String} AND article_id = {id:String} AND viewport_bucket = {bucket:UInt16}
       GROUP BY x_cell, y_cell
      HAVING clicks > 0
       ORDER BY clicks DESC
       LIMIT 20000`, { site, id: articleId, bucket });

    const selectors = await chQuery(`
      SELECT click_selector, count() AS clicks
        FROM pulse.events
       WHERE site = {site:String} AND article_id = {id:String}
         AND event_type = 'click' AND is_bot = 0 AND click_selector != ''
         AND timestamp >= now() - INTERVAL 30 DAY
       GROUP BY click_selector ORDER BY clicks DESC LIMIT 20`, { site, id: articleId });

    const maxClicks = cells.reduce((m, c) => Math.max(m, num(c.clicks)), 0);

    return {
      available: true,
      viewportBucket: bucket,
      cellSize: 10,
      maxClicks,
      cells: cells.map((c) => ({
        x: num(c.x_cell) * 10,
        y: num(c.y_cell) * 10,
        clicks: num(c.clicks),
        intensity: maxClicks > 0 ? Math.round((num(c.clicks) / maxClicks) * 100) / 100 : 0,
      })),
      topSelectors: selectors.map((s) => ({ selector: s.click_selector, clicks: num(s.clicks) })),
    };
  });

  app.get('/articles/export.csv', auth, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const scope = authorScope(req.user, req.query.author);

    const rows = await pgQuery(
      `SELECT article_id, title, author, category, content_type, published_at,
              pageviews_total, pageviews_24h, pageviews_7d, unique_visitors,
              avg_time_on_page_sec, scroll_completion_rate, read_completion_rate
         FROM article_stats
        WHERE site=$1 ${scope.author ? 'AND author=$2' : ''}
        ORDER BY pageviews_total DESC LIMIT 5000`,
      scope.author ? [site, scope.author] : [site],
    );

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="pulse-clanci.csv"');
    return toCsv(rows);
  });
}
