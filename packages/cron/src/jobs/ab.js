/**
 * A/B rezultati i statisticka znacajnost (sekcija 8.2, 8.3).
 *
 * Pobednik se upisuje SAMO ako su ispunjena oba uslova iz spec-a:
 * 95%+ konfidencija I minimum impresija po varijanti.
 */
import { chQuery, pgQuery, evaluateAbTest, createLogger } from '@pulse/shared';

const log = createLogger('ab');
const num = (v) => Number(v ?? 0);

export async function updateAbResults() {
  const tests = await pgQuery(
    `SELECT t.test_id, t.site, t.article_id, t.status, t.auto_promote,
            t.min_impressions, t.confidence_target,
            json_agg(json_build_object('variant', v.variant, 'is_control', v.is_control)) AS variants
       FROM ab_tests t
       JOIN ab_variants v ON v.test_id = t.test_id
      WHERE t.status = 'running'
      GROUP BY t.id`,
  );

  if (!tests.length) return 0;

  const testIds = tests.map((t) => t.test_id);
  const counts = await chQuery(`
    SELECT ab_test_id, ab_variant, sum(impressions) AS impressions, sum(clicks) AS clicks
      FROM pulse.ab_events
     WHERE ab_test_id IN ({ids:Array(String)})
     GROUP BY ab_test_id, ab_variant`, { ids: testIds });

  const byTest = new Map();
  for (const c of counts) {
    if (!byTest.has(c.ab_test_id)) byTest.set(c.ab_test_id, new Map());
    byTest.get(c.ab_test_id).set(c.ab_variant, {
      impressions: num(c.impressions),
      clicks: num(c.clicks),
    });
  }

  let updated = 0;

  for (const test of tests) {
    const observed = byTest.get(test.test_id) ?? new Map();

    const variants = test.variants.map((v) => ({
      variant: v.variant,
      is_control: v.is_control,
      impressions: observed.get(v.variant)?.impressions ?? 0,
      clicks: observed.get(v.variant)?.clicks ?? 0,
    }));

    const result = evaluateAbTest(variants, {
      minImpressions: num(test.min_impressions) || 1000,
      confidenceTarget: num(test.confidence_target) || 0.95,
    });

    for (const row of result.rows) {
      await pgQuery(
        `INSERT INTO ab_results (test_id, variant, impressions, clicks, ctr, p_value, confidence, is_significant, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (test_id, variant) DO UPDATE SET
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           ctr = EXCLUDED.ctr,
           p_value = EXCLUDED.p_value,
           confidence = EXCLUDED.confidence,
           is_significant = EXCLUDED.is_significant,
           updated_at = now()`,
        [test.test_id, row.variant, row.impressions, row.clicks,
          row.ctr.toFixed(4), row.pValue === null ? null : row.pValue.toFixed(8),
          row.confidence.toFixed(4), row.isSignificant],
      );
      updated++;
    }

    // Auto-promote: samo uz eksplicitno ukljucen flag (sekcija 8.3, faza 2)
    if (result.winner && test.auto_promote) {
      await pgQuery(
        `UPDATE ab_tests
            SET status = 'completed', winner_variant = $2, completed_at = now()
          WHERE test_id = $1 AND status = 'running'`,
        [test.test_id, result.winner],
      );
      log.info({ testId: test.test_id, winner: result.winner }, 'A/B test automatski zavrsen');
    }
  }

  return updated;
}
