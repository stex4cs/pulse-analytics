/**
 * Omotac oko svakog cron posla: metrika, upis u job_runs, zastita od
 * preklapanja i azuriranje vodoziga za backfill (sekcija 14, Faza 3).
 */
import { pgQuery, pgQueryOne, metrics, createLogger } from '@pulse/shared';

const log = createLogger('cron');
const activeJobs = new Set();

export async function runJob(name, fn, { windowStart = null, windowEnd = null } = {}) {
  if (activeJobs.has(name)) {
    log.warn({ job: name }, 'prethodno izvrsavanje jos traje, preskacem');
    return { skipped: true };
  }
  activeJobs.add(name);

  const endTimer = metrics.cronDuration.startTimer({ job: name });
  const started = Date.now();

  const run = await pgQueryOne(
    `INSERT INTO job_runs (job_name, window_start, window_end, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [name, windowStart, windowEnd],
  ).catch(() => null);

  try {
    const result = await fn();
    const rows = Number(result?.rows ?? 0);

    if (run) {
      await pgQuery(
        `UPDATE job_runs SET status='success', rows_written=$2, finished_at=now() WHERE id=$1`,
        [run.id, rows],
      );
    }
    metrics.cronLastSuccess.set({ job: name }, Math.floor(Date.now() / 1000));
    log.info({ job: name, rows, ms: Date.now() - started }, 'posao zavrsen');
    return { ok: true, rows, ...result };
  } catch (err) {
    metrics.cronErrors.inc({ job: name });
    if (run) {
      await pgQuery(
        `UPDATE job_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1`,
        [run.id, String(err.message).slice(0, 2000)],
      ).catch(() => {});
    }
    log.error({ job: name, err: err.message, stack: err.stack }, 'posao pao');
    return { ok: false, error: err.message };
  } finally {
    activeJobs.delete(name);
    endTimer();
  }
}

export async function getWatermark(job, fallbackDaysBack = 3) {
  const row = await pgQueryOne('SELECT watermark FROM job_watermarks WHERE job_name = $1', [job]);
  if (row?.watermark) return new Date(row.watermark);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - fallbackDaysBack);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function setWatermark(job, value) {
  await pgQuery(
    `INSERT INTO job_watermarks (job_name, watermark, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (job_name) DO UPDATE SET watermark = EXCLUDED.watermark, updated_at = now()`,
    [job, value],
  );
}

export { log as cronLog };
