import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-change-me-0123456789abcdef0123456789abcdef';

function loadEnvFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, quiet: true });
    }
  }
}
loadEnvFiles();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  APP_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://postgres@127.0.0.1:55433/coedit'),
  REDIS_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  JWT_SECRET: z.string().min(32).default(DEV_SECRET),
  ACCESS_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  WS_TICKET_TTL_SECONDS: z.coerce.number().int().min(15).max(600).default(90),
  SNAPSHOT_INTERVAL_MS: z.coerce.number().int().min(5_000).default(60_000),
  SNAPSHOT_MAX_UPDATES: z.coerce.number().int().min(10).default(200),
  ROOM_IDLE_MS: z.coerce.number().int().min(1_000).default(45_000),
  MAX_WS_PAYLOAD_BYTES: z.coerce.number().int().min(16_384).default(1_048_576),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTO_MIGRATE: z.enum(['true', 'false']).default('true'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  throw new Error('Invalid environment configuration');
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && env.JWT_SECRET === DEV_SECRET) {
  throw new Error('JWT_SECRET must be changed for production deployments');
}

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  appOrigins: string[];
  databaseUrl: string;
  redisUrl: string | undefined;
  jwtSecret: string;
  accessTokenTtlHours: number;
  wsTicketTtlSeconds: number;
  snapshotIntervalMs: number;
  snapshotMaxUpdates: number;
  roomIdleMs: number;
  maxWsPayloadBytes: number;
  logLevel: string;
  autoMigrate: boolean;
}

export const config: Config = {
  env: env.NODE_ENV,
  port: env.PORT,
  appOrigins: env.APP_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  jwtSecret: env.JWT_SECRET,
  accessTokenTtlHours: env.ACCESS_TOKEN_TTL_HOURS,
  wsTicketTtlSeconds: env.WS_TICKET_TTL_SECONDS,
  snapshotIntervalMs: env.SNAPSHOT_INTERVAL_MS,
  snapshotMaxUpdates: env.SNAPSHOT_MAX_UPDATES,
  roomIdleMs: env.ROOM_IDLE_MS,
  maxWsPayloadBytes: env.MAX_WS_PAYLOAD_BYTES,
  logLevel: env.LOG_LEVEL,
  autoMigrate: env.AUTO_MIGRATE === 'true',
};

export const usingDevSecret = config.jwtSecret === DEV_SECRET;
