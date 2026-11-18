import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(connectionString: string = config.databaseUrl): Db {
  const pool = new Pool({
    connectionString,
    max: config.env === 'test' ? 5 : 12,
    idleTimeoutMillis: 30_000,
    application_name: 'coedit-server',
  });
  pool.on('error', (error) => {
    logger.error({ err: error }, 'postgres pool error');
  });
  return pool;
}

export async function withTransaction<T>(
  pool: Db,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
