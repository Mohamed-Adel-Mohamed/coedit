import { createPool } from '../db.js';
import { runMigrations } from '../db/migrate.js';
import { logger } from '../logger.js';

const pool = createPool();

try {
  const applied = await runMigrations(pool);
  if (applied.length === 0) {
    logger.info('database already up to date');
  } else {
    logger.info({ applied }, 'migrations complete');
  }
} catch (error) {
  logger.error({ err: error }, 'migration failed');
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
