import { startServer } from './server.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const running = await startServer();
  const webOrigin = process.env.APP_ORIGINS?.split(',')[0] ?? 'http://localhost:3000';
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  CoEdit collaboration server',
      `  REST   ${running.httpUrl}/api/health`,
      `  WS     ${running.wsUrl}`,
      `  Web    ${webOrigin}`,
      '',
    ].join('\n'),
  );

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    void running
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'failed to start collaboration server');
  process.exit(1);
});
