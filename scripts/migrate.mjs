/**
 * Migracije: ClickHouse sema + materialized views, pa Postgres sema.
 * Idempotentno - sve je CREATE ... IF NOT EXISTS.
 *
 *   node scripts/migrate.mjs
 *   node scripts/migrate.mjs --only=clickhouse
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chExec, getPool, closeClickHouse, closePostgres, config } from '@pulse/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

/** Deli SQL fajl na iskaze. Nasa sema nema ';' unutar literala. */
function statements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

async function migrateClickHouse() {
  const dir = path.join(root, 'db', 'clickhouse');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const stmts = statements(sql);
    process.stdout.write(`ClickHouse ${file}: ${stmts.length} iskaza\n`);

    for (const [i, stmt] of stmts.entries()) {
      try {
        await chExec(stmt);
      } catch (err) {
        console.error(`\n  iskaz #${i + 1} pao:\n${stmt.slice(0, 300)}\n`);
        throw err;
      }
    }
    process.stdout.write(`  ✓ ${file}\n`);
  }
}

async function migratePostgres() {
  const dir = path.join(root, 'db', 'postgres');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pool = getPool();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    process.stdout.write(`Postgres ${file}\n`);
    // Postgres izvrsava ceo fajl u jednoj transakciji
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      process.stdout.write(`  ✓ ${file}\n`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

try {
  console.log(`ClickHouse: ${config.clickhouse.url}/${config.clickhouse.database}`);
  console.log(`Postgres  : ${config.postgres.host}:${config.postgres.port}/${config.postgres.database}\n`);

  if (only !== 'postgres') await migrateClickHouse();
  if (only !== 'clickhouse') await migratePostgres();

  console.log('\nMigracije završene.');
} catch (err) {
  console.error('\nMigracija pala:', err.message);
  process.exitCode = 1;
} finally {
  await closeClickHouse();
  await closePostgres();
}
