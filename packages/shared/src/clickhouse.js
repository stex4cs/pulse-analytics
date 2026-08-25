import { createClient } from '@clickhouse/client';
import { config } from './config.js';

let client = null;

export function getClickHouse() {
  if (client) return client;
  client = createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
    clickhouse_settings: {
      // Insert-i idu u batch-evima iz worker-a, ne treba nam jos jedan sloj bafera
      async_insert: 0,
      date_time_input_format: 'best_effort',
    },
    request_timeout: 60_000,
    max_open_connections: 10,
    compression: { response: true, request: false },
  });
  return client;
}

/** SELECT koji vraca niz objekata. */
export async function chQuery(query, params = {}) {
  const rs = await getClickHouse().query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });
  return rs.json();
}

/** SELECT koji vraca prvi red ili null. */
export async function chQueryOne(query, params = {}) {
  const rows = await chQuery(query, params);
  return rows[0] ?? null;
}

/** DDL / DELETE / ALTER. */
export async function chExec(query, params = {}) {
  await getClickHouse().command({
    query,
    query_params: params,
    clickhouse_settings: { wait_end_of_query: 1 },
  });
}

/** Batch insert (JSONEachRow). */
export async function chInsert(table, rows) {
  if (!rows.length) return 0;
  await getClickHouse().insert({
    table,
    values: rows,
    format: 'JSONEachRow',
  });
  return rows.length;
}

export async function closeClickHouse() {
  if (client) {
    await client.close();
    client = null;
  }
}
