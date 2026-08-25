/**
 * Jedinstveni posetioci preko proizvoljnog perioda.
 *
 * ZASTO OVO POSTOJI (sekcija 15.3):
 * unique_visitors se NE SABIRA. Isti čitalac koji dođe u ponedeljak i u sredu
 * je jedan posetilac, a zbir dnevnih redova iz Postgres-a bi ga izbrojao dvaput.
 * Greška je tiha - brojevi izgledaju razumno, samo su netačni, i to sve više
 * što je period duži.
 *
 * Zato je ovo jedini izuzetak od pravila "dashboard čita Postgres": uniq state
 * kolone se mogu spojiti isključivo u ClickHouse-u, preko uniqMerge. Upiti idu
 * nad dnevnim MV tabelama (autori × dani, kanali × dani) koje su male - reda
 * hiljada redova - pa je cena zanemarljiva.
 *
 * Dnevni i unapred izračunati nedeljni/mesečni redovi u Postgres-u su tačni
 * sami za sebe i za njih ovo nije potrebno.
 */
import { chQuery } from '@pulse/shared';

const num = (v) => Number(v ?? 0);

/** Ukupno jedinstvenih posetilaca za sajt u periodu. */
export async function totalUniqueVisitors(site, from, to) {
  const [row] = await chQuery(`
    SELECT uniqMerge(visitors_state) AS uv
      FROM pulse.source_daily
     WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}`,
  { site, from, to });
  return num(row?.uv);
}

/** Jedinstveni posetioci po autoru. @returns {Map<string, number>} */
export async function uniqueVisitorsByAuthor(site, from, to) {
  const rows = await chQuery(`
    SELECT author, uniqMerge(visitors_state) AS uv
      FROM pulse.author_daily
     WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
     GROUP BY author`,
  { site, from, to });
  return new Map(rows.map((r) => [r.author, num(r.uv)]));
}

/** Jedinstveni posetioci po kanalu. @returns {Map<string, number>} */
export async function uniqueVisitorsBySource(site, from, to) {
  const rows = await chQuery(`
    SELECT traffic_source, uniqMerge(visitors_state) AS uv
      FROM pulse.source_daily
     WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
     GROUP BY traffic_source`,
  { site, from, to });
  return new Map(rows.map((r) => [r.traffic_source, num(r.uv)]));
}

/** Jedinstveni posetioci po kategoriji (punoj ili korenskoj). */
export async function uniqueVisitorsByCategory(site, from, to, { root = false } = {}) {
  const column = root ? 'category_root' : 'category';
  const rows = await chQuery(`
    SELECT ${column} AS key, uniqMerge(visitors_state) AS uv
      FROM pulse.category_daily
     WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
     GROUP BY key`,
  { site, from, to });
  return new Map(rows.map((r) => [r.key, num(r.uv)]));
}

/** Jedinstveni posetioci po tagu. */
export async function uniqueVisitorsByTag(site, from, to) {
  const rows = await chQuery(`
    SELECT tag, uniqMerge(sessions_state) AS uv
      FROM pulse.tag_daily
     WHERE site = {site:String} AND date BETWEEN {from:Date} AND {to:Date}
     GROUP BY tag`,
  { site, from, to });
  return new Map(rows.map((r) => [r.tag, num(r.uv)]));
}
