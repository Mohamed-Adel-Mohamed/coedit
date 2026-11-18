import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'coedit-server' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'token', '*.token', '*.password'],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
