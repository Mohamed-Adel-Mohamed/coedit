import express, { type Express } from 'express';
import type { AppDeps } from './http/context.js';
import { authenticate } from './auth/middleware.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './errors.js';

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: deps.rooms.size,
      pubsub: deps.pubsub.kind,
      tickets: deps.tickets.kind,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use(authenticate(deps.pool));
  app.use('/api', apiRouter(deps));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
