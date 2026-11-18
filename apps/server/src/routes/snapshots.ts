import { Router } from 'express';
import type { AppDeps } from '../http/context.js';
import { requireAccess } from '../access.js';
import { notFound } from '../errors.js';
import { param } from '../http/params.js';
import { rateLimit } from '../http/rate-limit.js';
import {
  getSnapshot,
  listSnapshots,
  toSnapshotDetail,
  toSnapshotSummary,
} from '../repositories/snapshots.js';
import { createSnapshotSchema } from '../validation.js';

export function snapshotRoutes(deps: AppDeps): Router {
  const router = Router();
  const writeLimit = rateLimit('snapshots-write', 30, 60 * 1000);

  router.get('/documents/:id/snapshots', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'read');
    const rows = await listSnapshots(deps.pool, access.document.id);
    res.json({ snapshots: rows.map(toSnapshotSummary) });
  });

  router.post('/documents/:id/snapshots', writeLimit, async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'edit');
    const body = createSnapshotSchema.parse(req.body ?? {});
    const room = await deps.rooms.get(access.document.id);
    const row = await room.createSnapshot(access.user?.id ?? null, body.label);
    res.status(201).json({ snapshot: toSnapshotSummary(row) });
  });

  router.get('/documents/:id/snapshots/:snapshotId', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'read');
    const row = await getSnapshot(deps.pool, access.document.id, param(req, 'snapshotId'));
    if (!row) throw notFound('Snapshot not found');
    res.json({ snapshot: toSnapshotDetail(row) });
  });

  router.post('/documents/:id/snapshots/:snapshotId/restore', writeLimit, async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'edit');
    const snapshot = await getSnapshot(deps.pool, access.document.id, param(req, 'snapshotId'));
    if (!snapshot) throw notFound('Snapshot not found');

    const actorId = access.user?.id ?? null;
    const room = await deps.rooms.get(access.document.id);
    await room.restoreFromSnapshot(snapshot, actorId);
    res.json({ ok: true, restoredFrom: snapshot.id });
  });

  return router;
}
