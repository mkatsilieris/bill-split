import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

const { Pool } = pg;

// Return NUMERIC columns as JS numbers (we only store 2-decimal money, safe range).
pg.types.setTypeParser(1700, (v: string) => Number(v));
// Return DATE columns as plain 'YYYY-MM-DD' strings instead of Date objects.
pg.types.setTypeParser(1082, (v: string) => v);

export const pool = new Pool({ connectionString: config.databaseUrl });
pool.on('error', (err) => log.error({ err }, 'idle database client error'));

export type Queryable = pg.Pool | pg.PoolClient;

export async function waitForDb(retries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      log.warn({ attempt, retries, reason: (err as Error).message }, 'database not ready yet');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database did not become ready in time');
}

export async function migrate(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
  log.info('database schema is up to date');
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
