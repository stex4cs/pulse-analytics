/**
 * Fallback spool (sekcija 4.3): ako Redis nije dostupan, eventi idu u lokalni
 * append-only fajl. Worker ih kasnije pokupi. Nikad ne gubimo evente.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, metrics } from '@pulse/shared';

let stream = null;
let currentFile = '';

function fileForNow() {
  const stamp = new Date().toISOString().slice(0, 13).replace(/[:T-]/g, '');
  return path.join(config.ingest.spoolDir, `events-${stamp}.ndjson`);
}

function ensureStream() {
  const target = fileForNow();
  if (stream && currentFile === target) return stream;

  if (stream) stream.end();
  fs.mkdirSync(config.ingest.spoolDir, { recursive: true });
  currentFile = target;
  stream = fs.createWriteStream(target, { flags: 'a' });
  stream.on('error', (err) => {
    console.error('[spool] write error:', err.message);
    stream = null;
  });
  return stream;
}

/**
 * @param {object[]} rows redovi spremni za ClickHouse
 * @returns {boolean} da li je upis uspeo
 */
export function spoolRows(rows) {
  if (!rows.length) return true;
  try {
    const s = ensureStream();
    if (!s) return false;
    s.write(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    metrics.spoolWrites.inc(rows.length);
    return true;
  } catch (err) {
    console.error('[spool] fatal:', err.message);
    return false;
  }
}

export function closeSpool() {
  if (stream) {
    stream.end();
    stream = null;
  }
}
