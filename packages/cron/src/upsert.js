/**
 * Bulk UPSERT u Postgres. Gradi visered INSERT ... ON CONFLICT DO UPDATE,
 * deljen na komade da se ne prekoraci limit od 65535 parametara po iskazu.
 */
import { getPool } from '@pulse/shared';

const PG_MAX_PARAMS = 65535;

/**
 * @param {string} table
 * @param {string[]} columns        sve kolone koje se upisuju
 * @param {string[]} conflictKeys   kolone iz UNIQUE/PK ogranicenja
 * @param {object[]} rows           objekti sa kljucevima iz `columns`
 * @param {string[]} [updateColumns] kolone koje se azuriraju pri konfliktu
 *                                   (podrazumevano: sve osim conflictKeys)
 * @returns {Promise<number>} broj upisanih redova
 */
export async function bulkUpsert(table, columns, conflictKeys, rows, updateColumns) {
  if (!rows.length) return 0;

  const updates = (updateColumns ?? columns.filter((c) => !conflictKeys.includes(c)))
    .map((c) => `${c} = EXCLUDED.${c}`);
  if (!updates.some((u) => u.startsWith('updated_at'))) updates.push('updated_at = now()');

  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(PG_MAX_PARAMS / perRow));
  const pool = getPool();
  let written = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(row[col] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(',')})`;
    });

    const sql = `
      INSERT INTO ${table} (${columns.join(',')})
      VALUES ${tuples.join(',')}
      ON CONFLICT (${conflictKeys.join(',')}) DO UPDATE SET ${updates.join(', ')}
    `;
    const res = await pool.query(sql, params);
    written += res.rowCount ?? chunk.length;
  }
  return written;
}
