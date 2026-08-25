/**
 * GDPR (sekcija 12).
 *
 * DELETE /gdpr/visitor/:visitorId brise sve evente tog posetioca iz
 * ClickHouse-a. Agregati se ne diraju - oni su anonimni i ne sadrze
 * visitor_id (sekcija 12.3).
 *
 * ALTER ... DELETE u ClickHouse-u je asinhrona mutacija: endpoint je
 * prihvata i vraca 202, a stanje se prati kroz gdpr_deletions tabelu.
 */
import { chExec, chQuery, pgQuery, pgQueryOne } from '@pulse/shared';
import { ROLES } from '../auth.js';

export default async function gdprRoutes(app) {
  const admin = { preHandler: [app.requireRole(ROLES.ADMIN)] };

  app.delete('/gdpr/visitor/:visitorId', admin, async (req, reply) => {
    const visitorId = String(req.params.visitorId ?? '').trim();
    if (!visitorId || visitorId.length > 64) {
      return reply.code(400).send({ error: 'Neispravan visitorId' });
    }

    const [count] = await chQuery(
      'SELECT count() AS n FROM pulse.events WHERE visitor_id = {vid:String}',
      { vid: visitorId },
    );
    const rows = Number(count?.n ?? 0);

    const record = await pgQueryOne(
      `INSERT INTO gdpr_deletions (visitor_id, rows_affected, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [visitorId, rows],
    );

    try {
      await chExec('ALTER TABLE pulse.events DELETE WHERE visitor_id = {vid:String}', { vid: visitorId });
      await chExec('ALTER TABLE pulse.visitor_touch DELETE WHERE visitor_id = {vid:String}', { vid: visitorId });

      await pgQuery(
        `UPDATE gdpr_deletions SET status='completed', completed_at=now() WHERE id=$1`,
        [record.id],
      );
    } catch (err) {
      await pgQuery(`UPDATE gdpr_deletions SET status='failed' WHERE id=$1`, [record.id]);
      throw err;
    }

    return reply.code(202).send({
      visitorId,
      rowsAffected: rows,
      status: 'accepted',
      note: 'Brisanje je pokrenuto kao ClickHouse mutacija i završava se asinhrono. '
        + 'Agregati ne sadrže visitor_id, pa se ne menjaju.',
    });
  });

  app.get('/gdpr/deletions', admin, async () => {
    const deletions = await pgQuery(
      'SELECT * FROM gdpr_deletions ORDER BY requested_at DESC LIMIT 200',
    );
    return { deletions };
  });

  /** Sta Pulse zna o jednom posetiocu - pravo na uvid (GDPR clan 15). */
  app.get('/gdpr/visitor/:visitorId', admin, async (req) => {
    const visitorId = String(req.params.visitorId ?? '').trim();

    const summary = await chQuery(`
      SELECT site,
             count()                       AS events,
             min(timestamp)                AS first_seen,
             max(timestamp)                AS last_seen,
             uniq(session_id)              AS sessions,
             groupUniqArray(10)(traffic_source) AS sources,
             any(country)                  AS country
        FROM pulse.events
       WHERE visitor_id = {vid:String}
       GROUP BY site`, { vid: visitorId });

    return {
      visitorId,
      records: summary,
      note: 'IP adresa se nikad ne čuva - samo geo rezultat i dnevno-salted hash za bot detekciju.',
    };
  });
}
