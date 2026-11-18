import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_LOCK_ID = 728_331_004;

/**
 * Applies pending .sql migrations exactly once, serialised across processes with a
 * PostgreSQL advisory lock. Each migration runs inside its own transaction.
 */
export async function runMigrations(pool: Db): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const seen = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const known = new Set(seen.rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (known.has(file)) continue;
      const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        logger.info({ migration: file }, 'migration applied');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
