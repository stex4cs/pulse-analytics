/**
 * Odakle dolaze klikovi — jedinstveno za autore, kategorije i tagove.
 *
 * Do sada je svaka dimenzija imala svoju polovičnu verziju: autor je imao
 * `byChannel` u detalju, kategorija matricu na svom ekranu, a tag ništa.
 * Ovde je isti odgovor za sve tri, pa se mogu i porediti.
 *
 * Čita iz `*_source_daily` MV-ova, koji su mali (entitet × kanal × dan).
 */
import { chQuery, SOURCE_LABELS } from '@pulse/shared';
import { siteScope, authorScope, ROLES } from '../auth.js';
import { dateRange, limit, toCsv } from '../utils.js';

const num = (v) => Number(v ?? 0);

/** Bela lista dimenzija — nikad korisnički string u imenu tabele. */
const DIMENSIONS = {
  author: { table: 'pulse.author_source_daily', column: 'author', label: 'Autor' },
  category: { table: 'pulse.category_source_daily', column: 'category', label: 'Kategorija' },
  tag: { table: 'pulse.tag_source_daily', column: 'tag', label: 'Tag' },
};

export default async function channelRoutes(app) {
  const auth = { preHandler: [app.authenticate] };

  /**
   * GET /channels?dimension=author|category|tag&days=30
   *
   * Vraća matricu entitet × kanal, sa apsolutnim brojevima i udelima.
   * Udeo je ono što se zapravo čita: 60% sa Facebook-a znači nešto drugo
   * za autora sa 200.000 pregleda nego za autora sa 2.000.
   */
  app.get('/channels', auth, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });

    const key = String(req.query.dimension ?? 'author');
    const dim = DIMENSIONS[key];
    if (!dim) {
      const err = new Error(`dimension mora biti jedno od: ${Object.keys(DIMENSIONS).join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    // Autor sme da vidi samo svoj red
    const scope = authorScope(req.user, req.query.entity && key === 'author' ? String(req.query.entity) : undefined);
    const params = { site, from, to };
    let filter = '';
    if (key === 'author' && scope.author) {
      filter = 'AND author = {author:String}';
      params.author = scope.author;
    } else if (req.query.entity) {
      filter = `AND ${dim.column} = {entity:String}`;
      params.entity = String(req.query.entity);
    }

    const rows = await chQuery(`
      SELECT ${dim.column} AS entity, traffic_source, sum(pageviews) AS pageviews
        FROM ${dim.table}
       WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date} ${filter}
       GROUP BY entity, traffic_source`, params);

    const byEntity = new Map();
    const sources = new Set();
    for (const r of rows) {
      sources.add(r.traffic_source);
      if (!byEntity.has(r.entity)) byEntity.set(r.entity, {});
      byEntity.get(r.entity)[r.traffic_source] = num(r.pageviews);
    }

    const max = limit(req.query, 25, 200);
    const out = [...byEntity].map(([entity, bySource]) => {
      const total = Object.values(bySource).reduce((a, b) => a + b, 0);
      const shares = Object.fromEntries(Object.entries(bySource)
        .map(([s, v]) => [s, total > 0 ? Math.round((v / total) * 1000) / 10 : 0]));

      // Kanal koji nosi entitet: koristan za "ova rubrika visi o Facebook-u"
      const top = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0];

      return {
        entity,
        total,
        bySource,
        shares,
        topSource: top ? top[0] : null,
        topShare: top && total > 0 ? Math.round((top[1] / total) * 1000) / 10 : 0,
      };
    }).sort((a, b) => b.total - a.total).slice(0, max);

    // Ukupno po kanalu, da se udeli entiteta mogu porediti sa prosekom sajta
    const siteTotals = {};
    for (const r of rows) {
      siteTotals[r.traffic_source] = (siteTotals[r.traffic_source] ?? 0) + num(r.pageviews);
    }
    const siteTotal = Object.values(siteTotals).reduce((a, b) => a + b, 0);

    return {
      dimension: key,
      dimensionLabel: dim.label,
      range: { from, to },
      sources: [...sources]
        .sort((a, b) => (siteTotals[b] ?? 0) - (siteTotals[a] ?? 0))
        .map((s) => ({
          source: s,
          label: SOURCE_LABELS[s] ?? s,
          pageviews: siteTotals[s] ?? 0,
          share: siteTotal > 0 ? Math.round((siteTotals[s] / siteTotal) * 1000) / 10 : 0,
        })),
      rows: out,
    };
  });

  app.get('/channels/export.csv', { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] }, async (req, reply) => {
    const site = siteScope(req.user, req.query.site);
    const { from, to } = dateRange({ days: 30, ...req.query });
    const dim = DIMENSIONS[String(req.query.dimension ?? 'author')];
    if (!dim) {
      const err = new Error('Neispravna dimenzija');
      err.statusCode = 400;
      throw err;
    }

    const rows = await chQuery(`
      SELECT ${dim.column} AS entity, traffic_source, sum(pageviews) AS pageviews
        FROM ${dim.table}
       WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
       GROUP BY entity, traffic_source
       ORDER BY pageviews DESC
       LIMIT 5000`, { site, from, to });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="pulse-kanali-${dim.column}-${from}_${to}.csv"`);
    return toCsv(rows.map((r) => ({
      [dim.column]: r.entity,
      traffic_source: r.traffic_source,
      pageviews: num(r.pageviews),
    })));
  });
}
