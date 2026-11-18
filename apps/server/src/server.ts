import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { config as baseConfig, type Config } from './config.js';
import { logger } from './logger.js';
import { createPool } from './db.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';
import { RoomManager } from './realtime/rooms.js';
import { attachRealtime } from './realtime/gateway.js';
import {
  MemoryPubSub,
  RedisPubSub,
  type PubSub,
} from './realtime/pubsub.js';
import {
  MemoryTicketStore,
  RedisTicketStore,
  type TicketStore,
} from './realtime/ticket-store.js';
import type { AppDeps } from './http/context.js';

export interface StartServerOptions {
  port?: number;
  databaseUrl?: string;
  /** `null` forces in-memory mode; omit to use config. */
  redisUrl?: string | null;
  autoMigrate?: boolean;
  logLevel?: Config['logLevel'];
}

export interface RunningServer {
  port: number;
  httpUrl: string;
  wsUrl: string;
  deps: AppDeps;
  close(): Promise<void>;
}

async function connectRedis(
  url: string,
): Promise<{ command: Redis; subscriber: Redis } | null> {
  const options = {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  } as const;
  const command = new Redis(url, options);
  command.on('error', (error) => logger.warn({ err: error }, 'redis command connection error'));
  try {
    await command.connect();
    await command.ping();
    const subscriber = command.duplicate({ lazyConnect: true });
    subscriber.on('error', (error) => logger.warn({ err: error }, 'redis subscriber error'));
    await subscriber.connect();
    await subscriber.ping();
    return { command, subscriber };
  } catch (error) {
    logger.warn(
      { err: error },
      'Redis unavailable — falling back to in-process pub/sub (single instance)',
    );
    command.disconnect();
    return null;
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const startedAt = Date.now();
  const config: Config = {
    ...baseConfig,
    port: options.port ?? baseConfig.port,
    databaseUrl: options.databaseUrl ?? baseConfig.databaseUrl,
    logLevel: options.logLevel ?? baseConfig.logLevel,
  };

  const pool = createPool(config.databaseUrl);
  if (options.autoMigrate ?? config.autoMigrate) {
    await runMigrations(pool);
  }

  const redisUrl =
    options.redisUrl === undefined ? config.redisUrl : options.redisUrl ?? undefined;
  const redis = redisUrl ? await connectRedis(redisUrl) : null;

  const pubsub: PubSub = redis
    ? new RedisPubSub(redis.command, redis.subscriber)
    : new MemoryPubSub();
  const tickets: TicketStore = redis
    ? new RedisTicketStore(redis.command)
    : new MemoryTicketStore();
  const instanceId = randomUUID();

  const rooms = new RoomManager({ pool, pubsub, instanceId, config, logger });
  const deps: AppDeps = { config, logger, pool, pubsub, rooms, tickets, instanceId };

  const app = createApp(deps);
  const server = http.createServer(app);
  const detachRealtime = attachRealtime(server, { config, logger, pool, rooms, tickets });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, '0.0.0.0');
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  const httpUrl = `http://127.0.0.1:${port}`;

  const close = async (): Promise<void> => {
    await detachRealtime();
    await rooms.closeAll();
    await pubsub.close();
    await tickets.close();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await pool.end().catch(() => undefined);
    logger.info(
      { port, uptimeMs: Date.now() - startedAt },
      'collaboration server stopped',
    );
  };

  logger.info(
    {
      port,
      pubsub: pubsub.kind,
      tickets: tickets.kind,
      database: config.databaseUrl.replace(/\/\/[^@]+@/, '//***@'),
    },
    'collaboration server ready',
  );

  return { port, httpUrl, wsUrl: `ws://127.0.0.1:${port}/ws`, deps, close };
}
