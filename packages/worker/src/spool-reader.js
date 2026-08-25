/**
 * Preuzimanje spool fajlova koje je ingest napravio dok je Redis bio dole
 * (sekcija 4.3). Fajl se brise tek posto je uspesno upisan u ClickHouse.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, chInsert, metrics } from '@pulse/shared';

const DONE_SUFFIX = '.done';

export async function replaySpool(log) {
  let dirents;
  try {
    dirents = await fs.readdir(config.worker.spoolDir);
  } catch {
    return 0;   // direktorijum ne postoji = nema sta da se preuzme
  }

  const files = dirents
    .filter((f) => f.endsWith('.ndjson'))
    .sort();

  let total = 0;
  for (const file of files) {
    const full = path.join(config.worker.spoolDir, file);

    // Preskoci fajl u koji ingest jos pise (izmenjen u poslednjih 60s)
    try {
      const stat = await fs.stat(full);
      if (Date.now() - stat.mtimeMs < 60_000) continue;
    } catch {
      continue;
    }

    try {
      const content = await fs.readFile(full, 'utf8');
      const rows = content
        .split('\n')
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);

      if (rows.length) {
        for (let i = 0; i < rows.length; i += config.worker.batchSize) {
          await chInsert('events', rows.slice(i, i + config.worker.batchSize));
        }
        metrics.workerEventsWritten.inc(rows.length);
        total += rows.length;
      }
      await fs.rename(full, full + DONE_SUFFIX);
      await fs.unlink(full + DONE_SUFFIX).catch(() => {});
      log.info({ file, rows: rows.length }, 'spool fajl preuzet');
    } catch (err) {
      metrics.clickhouseInsertErrors.inc();
      log.error({ file, err: err.message }, 'spool fajl nije preuzet, pokusacu ponovo');
    }
  }
  return total;
}
