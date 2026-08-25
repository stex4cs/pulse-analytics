/**
 * Geografija: države i gradovi, sa razradom po kanalu.
 *
 * ODSTUPANJE OD PRAVILA "dashboard čita Postgres", namerno:
 * geo se ukršta sa autorom, kategorijom, tagom i kanalom. Predračunati sve
 * te kombinacije u Postgresu znači eksploziju redova (države × gradovi ×
 * kanali × autori × tagovi), a ClickHouse to radi u milisekundama jer su
 * upravo takvi preseci ono za šta je napravljen.
 *
 * Bez filtera po entitetu ide se na `geo_daily` MV (mali, brz).
 * Sa filterom po autoru/kategoriji/tagu ide se na sirove evente — pod
 * datumskim opsegom to je skeniranje reda stotina hiljada redova, što je
 * za ClickHouse trivijalno.
 */
import { chQuery } from '@pulse/shared';
import { siteScope, authorScope, ROLES } from '../auth.js';
import { dateRange, limit, toCsv } from '../utils.js';

const num = (v) => Number(v ?? 0);

/**
 * Gradi WHERE uslove i parametre. Nijedna korisnička vrednost ne ulazi u SQL
 * kao tekst — sve ide kroz ClickHouse query_params.
 */
function entityFilter(query, scope) {
  const where = [];
  const params = {};

  if (scope.author) {
    where.push('author = {author:String}');
    params.author = scope.author;
  }
  if (query.category) {
    // Prefiks: "fudbal" hvata i "fudbal/superliga-srbije"
    where.push('(category = {category:String} OR startsWith(category, concat({category:String}, \'/\')))');
    params.category = String(query.category);
  }
  if (query.tag) {
    where.push('has(tags, {tag:String})');
    params.tag = String(query.tag);
  }
  if (query.source) {
    where.push('traffic_source = {source:String}');
    params.source = String(query.source);
  }
  return { where, params };
}

const usesRawEvents = (query, scope) => Boolean(scope.author || query.category || query.tag);

export default async function geoRoutes(app) {
  const auth = { preHandler: [app.authenticate] };

  // ── Države ───────────────────────────────────────────────────────────────
  app.get('/geo', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const scope = authorScope(req.user, req.query.author);
    const { where, params } = entityFilter(req.query, scope);

    const base = { site, from, to, ...params };

    const rows = usesRawEvents(req.query, scope)
      ? await chQuery(`
        SELECT country,
               count()             AS pageviews,
               uniq(session_id)    AS sessions,
               uniq(visitor_id)    AS unique_visitors
          FROM pulse.events
         WHERE site = {site:String}
           AND date BETWEEN {from:Date} AND {to:Date}
           AND event_type = 'pageview' AND is_bot = 0 AND country != ''
           ${where.length ? `AND ${where.join(' AND ')}` : ''}
         GROUP BY country
         ORDER BY pageviews DESC`, base)
      : await chQuery(`
        SELECT country,
               sum(pageviews)              AS pageviews,
               uniqMerge(sessions_state)   AS sessions,
               uniqMerge(visitors_state)   AS unique_visitors
          FROM pulse.geo_daily
         WHERE site = {site:String}
           AND date BETWEEN {from:Date} AND {to:Date}
           ${where.length ? `AND ${where.join(' AND ')}` : ''}
         GROUP BY country
         ORDER BY pageviews DESC`, base);

    const total = rows.reduce((s, r) => s + num(r.pageviews), 0);

    return {
      range: { from, to },
      total,
      countries: rows.map((r) => ({
        country: r.country,
        pageviews: num(r.pageviews),
        sessions: num(r.sessions),
        uniqueVisitors: num(r.unique_visitors),
        share: total > 0 ? Math.round((num(r.pageviews) / total) * 1000) / 10 : 0,
      })),
    };
  });

  // ── Gradovi ──────────────────────────────────────────────────────────────
  app.get('/geo/cities', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const scope = authorScope(req.user, req.query.author);
    const { where, params } = entityFilter(req.query, scope);

    if (req.query.country) {
      where.push('country = {country:String}');
      params.country = String(req.query.country);
    }

    const base = { site, from, to, ...params };
    const max = limit(req.query, 200, 1000);

    const rows = usesRawEvents(req.query, scope)
      ? await chQuery(`
        SELECT country, city,
               round(avg(lat), 2)  AS lat,
               round(avg(lon), 2)  AS lon,
               count()             AS pageviews,
               uniq(visitor_id)    AS unique_visitors
          FROM pulse.events
         WHERE site = {site:String}
           AND date BETWEEN {from:Date} AND {to:Date}
           AND event_type = 'pageview' AND is_bot = 0 AND city != ''
           ${where.length ? `AND ${where.join(' AND ')}` : ''}
         GROUP BY country, city
         ORDER BY pageviews DESC
         LIMIT ${max}`, base)
      : await chQuery(`
        SELECT country, city,
               round(anyLast(lat), 2)      AS lat,
               round(anyLast(lon), 2)      AS lon,
               sum(pageviews)              AS pageviews,
               uniqMerge(visitors_state)   AS unique_visitors
          FROM pulse.geo_daily
         WHERE site = {site:String}
           AND date BETWEEN {from:Date} AND {to:Date}
           AND city != ''
           ${where.length ? `AND ${where.join(' AND ')}` : ''}
         GROUP BY country, city
         ORDER BY pageviews DESC
         LIMIT ${max}`, base);

    return {
      range: { from, to },
      cities: rows.map((r) => ({
        country: r.country,
        city: r.city,
        lat: num(r.lat),
        lon: num(r.lon),
        pageviews: num(r.pageviews),
        uniqueVisitors: num(r.unique_visitors),
      })),
    };
  });

  /**
   * Uživo: ko je aktivan upravo sada, po državi i gradu.
   *
   * Čita `geo_minute` (TTL 2 dana) umesto sirovih eventa — mapa se osvežava na
   * 10 sekundi, pa svaki refresh mora da bude jeftin.
   */
  app.get('/realtime/geo', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const minutes = Math.min(60, Math.max(1, Number(req.query.minutes) || 30));

    const [countries, cities] = await Promise.all([
      chQuery(`
        SELECT country,
               sum(pageviews)            AS pageviews,
               uniqMerge(sessions_state) AS active_users
          FROM pulse.geo_minute
         WHERE site = {site:String} AND minute >= now() - INTERVAL {minutes:UInt16} MINUTE
         GROUP BY country
         ORDER BY active_users DESC`, { site, minutes }),
      chQuery(`
        SELECT country, city,
               round(anyLast(lat), 2)    AS lat,
               round(anyLast(lon), 2)    AS lon,
               sum(pageviews)            AS pageviews,
               uniqMerge(sessions_state) AS active_users
          FROM pulse.geo_minute
         WHERE site = {site:String}
           AND minute >= now() - INTERVAL {minutes:UInt16} MINUTE
           AND city != ''
         GROUP BY country, city
         ORDER BY active_users DESC
         LIMIT 300`, { site, minutes }),
    ]);

    const totalActive = countries.reduce((s, r) => s + num(r.active_users), 0);

    return {
      minutes,
      totalActive,
      totalPageviews: countries.reduce((s, r) => s + num(r.pageviews), 0),
      countries: countries.map((r) => ({
        country: r.country,
        pageviews: num(r.pageviews),
        uniqueVisitors: num(r.active_users),
        activeUsers: num(r.active_users),
        share: totalActive > 0 ? Math.round((num(r.active_users) / totalActive) * 1000) / 10 : 0,
      })),
      cities: cities.map((r) => ({
        country: r.country,
        city: r.city,
        lat: num(r.lat),
        lon: num(r.lon),
        pageviews: num(r.pageviews),
        uniqueVisitors: num(r.active_users),
        activeUsers: num(r.active_users),
      })),
    };
  });

  // ── Kanal × država: odakle geografski dolazi koji kanal ──────────────────
  app.get('/geo/channels', { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] }, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const topN = limit(req.query, 12, 40);

    const rows = await chQuery(`
      SELECT country, traffic_source, sum(pageviews) AS pageviews
        FROM pulse.geo_daily
       WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
       GROUP BY country, traffic_source`, { site, from, to });

    const byCountry = new Map();
    const sources = new Set();
    for (const r of rows) {
      sources.add(r.traffic_source);
      if (!byCountry.has(r.country)) byCountry.set(r.country, {});
      byCountry.get(r.country)[r.traffic_source] = num(r.pageviews);
    }

    const out = [...byCountry].map(([country, bySource]) => {
      const total = Object.values(bySource).reduce((a, b) => a + b, 0);
      return {
        country,
        total,
        bySource,
        shares: Object.fromEntries(Object.entries(bySource)
          .map(([s, v]) => [s, total > 0 ? Math.round((v / total) * 1000) / 10 : 0])),
      };
    }).sort((a, b) => b.total - a.total).slice(0, topN);

    return { range: { from, to }, sources: [...sources], rows: out };
  });

  app.get('/geo/export.csv', auth, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const scope = authorScope(req.user, req.query.author);
    const { where, params } = entityFilter(req.query, scope);

    const rows = await chQuery(`
      SELECT country, city,
             sum(pageviews)            AS pageviews,
             uniqMerge(visitors_state) AS unique_visitors
        FROM pulse.geo_daily
       WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
         ${where.length ? `AND ${where.join(' AND ')}` : ''}
       GROUP BY country, city
       ORDER BY pageviews DESC
       LIMIT 5000`, { site, from, to, ...params });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="pulse-geografija-${from}_${to}.csv"`);
    return toCsv(rows.map((r) => ({
      country: r.country,
      city: r.city,
      pageviews: num(r.pageviews),
      unique_visitors: num(r.unique_visitors),
    })));
  });
}
