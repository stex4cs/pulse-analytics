/**
 * A/B testovi naslova - upravljanje iz dashboard-a (sekcija 8).
 *
 * Pobednik se prikazuje samo kad su ispunjena OBA uslova iz 8.2. U svakom
 * drugom slucaju API eksplicitno vraca "jos nema dovoljno podataka", da
 * urednik ne bi doneo odluku na sumu.
 */
import crypto from 'node:crypto';
import { pgQuery, pgQueryOne, pgTransaction, evaluateAbTest } from '@pulse/shared';
import { siteScope, ROLES } from '../auth.js';

const num = (v) => Number(v ?? 0);

const REASON_TEXT = {
  insufficient_sample: 'Još nema dovoljno podataka',
  not_significant: 'Razlika još nije statistički značajna',
  need_two_variants: 'Test mora imati bar dve varijante',
  winner: 'Pobednik je utvrđen',
};

export default async function abRoutes(app) {
  const staff = { preHandler: [app.requireRole(ROLES.ADMIN, ROLES.EDITOR)] };

  // ── Lista testova ────────────────────────────────────────────────────────
  app.get('/ab/tests', staff, async (req) => {
    const site = siteScope(req.user, req.query.site);
    const rows = await pgQuery(
      `SELECT t.test_id, t.site, t.article_id, t.status, t.winner_variant, t.auto_promote,
              t.min_impressions, t.confidence_target, t.created_at, t.completed_at,
              a.title,
              json_agg(json_build_object(
                'variant', v.variant, 'headline', v.headline, 'isControl', v.is_control,
                'impressions', coalesce(r.impressions,0), 'clicks', coalesce(r.clicks,0),
                'ctr', r.ctr, 'confidence', r.confidence, 'isSignificant', coalesce(r.is_significant,false)
              ) ORDER BY v.variant) AS variants
         FROM ab_tests t
         JOIN ab_variants v ON v.test_id = t.test_id
         LEFT JOIN ab_results r ON r.test_id = t.test_id AND r.variant = v.variant
         LEFT JOIN article_stats a ON a.site = t.site AND a.article_id = t.article_id
        WHERE t.site = $1
        GROUP BY t.id, a.title
        ORDER BY t.created_at DESC
        LIMIT 200`,
      [site],
    );

    return {
      tests: rows.map((t) => {
        const evaluation = evaluateAbTest(
          t.variants.map((v) => ({
            variant: v.variant,
            is_control: v.isControl,
            impressions: num(v.impressions),
            clicks: num(v.clicks),
          })),
          { minImpressions: num(t.min_impressions), confidenceTarget: num(t.confidence_target) },
        );

        return {
          testId: t.test_id,
          articleId: t.article_id,
          articleTitle: t.title,
          status: t.status,
          autoPromote: t.auto_promote,
          minImpressions: num(t.min_impressions),
          createdAt: t.created_at,
          completedAt: t.completed_at,
          variants: t.variants.map((v) => ({
            ...v,
            impressions: num(v.impressions),
            clicks: num(v.clicks),
            ctr: v.ctr === null ? 0 : Math.round(num(v.ctr) * 10000) / 100,
          })),
          // Nikad "pobednik" bez oba uslova iz 8.2
          winner: t.winner_variant ?? evaluation.winner,
          hasEnoughData: evaluation.hasEnoughData,
          statusText: REASON_TEXT[evaluation.reason] ?? evaluation.reason,
          impressionsNeeded: evaluation.impressionsNeeded ?? 0,
        };
      }),
    };
  });

  // ── Kreiranje testa ──────────────────────────────────────────────────────
  app.post('/ab/tests', staff, async (req, reply) => {
    const site = siteScope(req.user, req.body?.site);
    const { articleId, variants, autoPromote = false, minImpressions = 1000 } = req.body ?? {};

    if (!articleId) return reply.code(400).send({ error: 'articleId je obavezan' });
    if (!Array.isArray(variants) || variants.length < 2 || variants.length > 3) {
      return reply.code(400).send({ error: 'Test mora imati 2 ili 3 varijante naslova' });
    }
    if (variants.some((v) => !v.headline || String(v.headline).trim().length < 5)) {
      return reply.code(400).send({ error: 'Svaka varijanta mora imati naslov' });
    }
    if (num(minImpressions) < 1000) {
      return reply.code(400).send({
        error: 'Minimum je 1000 impresija po varijanti - ispod toga se pobednik ne sme proglasiti (sekcija 8.2)',
      });
    }

    const existing = await pgQueryOne(
      `SELECT test_id FROM ab_tests WHERE site=$1 AND article_id=$2 AND status='running'`,
      [site, String(articleId)],
    );
    if (existing) {
      return reply.code(409).send({ error: 'Za ovaj članak već postoji aktivan test', testId: existing.test_id });
    }

    const testId = `ab_${crypto.randomBytes(8).toString('hex')}`;

    await pgTransaction(async (client) => {
      await client.query(
        `INSERT INTO ab_tests (test_id, site, article_id, status, auto_promote, min_impressions, created_by)
         VALUES ($1, $2, $3, 'running', $4, $5, $6)`,
        [testId, site, String(articleId), Boolean(autoPromote), num(minImpressions), req.user.id],
      );

      for (const [i, v] of variants.entries()) {
        await client.query(
          `INSERT INTO ab_variants (test_id, variant, headline, weight, is_control)
           VALUES ($1, $2, $3, $4, $5)`,
          [testId, v.variant ?? String.fromCharCode(65 + i), String(v.headline).trim(),
            num(v.weight) || 1, i === 0],
        );
      }
    });

    return reply.code(201).send({ testId, status: 'running' });
  });

  // ── Zaustavljanje / proglasenje pobednika ────────────────────────────────
  app.post('/ab/tests/:testId/stop', staff, async (req, reply) => {
    const { winner } = req.body ?? {};
    const testId = String(req.params.testId);

    const test = await pgQueryOne('SELECT * FROM ab_tests WHERE test_id = $1', [testId]);
    if (!test) return reply.code(404).send({ error: 'Test ne postoji' });
    siteScope(req.user, test.site);

    if (winner) {
      const variant = await pgQueryOne(
        'SELECT 1 FROM ab_variants WHERE test_id=$1 AND variant=$2', [testId, String(winner)],
      );
      if (!variant) return reply.code(400).send({ error: 'Ta varijanta ne postoji u testu' });

      await pgQuery(
        `UPDATE ab_tests SET status='completed', winner_variant=$2, completed_at=now() WHERE test_id=$1`,
        [testId, String(winner)],
      );
      return { testId, status: 'completed', winner };
    }

    await pgQuery(`UPDATE ab_tests SET status='stopped', completed_at=now() WHERE test_id=$1`, [testId]);
    return { testId, status: 'stopped' };
  });

  app.delete('/ab/tests/:testId', { preHandler: [app.requireRole(ROLES.ADMIN)] }, async (req, reply) => {
    const rows = await pgQuery('DELETE FROM ab_tests WHERE test_id=$1 RETURNING test_id', [String(req.params.testId)]);
    if (!rows.length) return reply.code(404).send({ error: 'Test ne postoji' });
    return { ok: true };
  });
}
