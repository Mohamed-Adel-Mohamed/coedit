import { Router } from 'express';
import type { AppDeps } from '../http/context.js';
import { authRoutes } from './auth.js';
import { documentRoutes } from './documents.js';
import { shareRoutes } from './shares.js';
import { commentRoutes } from './comments.js';
import { snapshotRoutes } from './snapshots.js';
import { ticketRoutes } from './tickets.js';

export function apiRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(authRoutes(deps));
  router.use(documentRoutes(deps));
  router.use(shareRoutes(deps));
  router.use(commentRoutes(deps));
  router.use(snapshotRoutes(deps));
  router.use(ticketRoutes(deps));
  return router;
}
