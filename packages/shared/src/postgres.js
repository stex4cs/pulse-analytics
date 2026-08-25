import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// BIGINT (OID 20) stize kao string; dashboard racuna sa brojevima.
// Vrednosti su brojevi pregleda - daleko ispod Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// NUMERIC (OID 1700)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

let pool = null;

export function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: config.postgres.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    // Pool sam obnavlja konekcije; ne rusimo proces.
    console.error('[pg] idle client error:', err.message);
  });
  return pool;
}

export async function pgQuery(text, params = []) {
  const res = await getPool().query(text, params);
  return res.rows;
}

export async function pgQueryOne(text, params = []) {
  const rows = await pgQuery(text, params);
  return rows[0] ?? null;
}

/** Transakcija sa automatskim rollback-om. */
export async function pgTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePostgres() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
