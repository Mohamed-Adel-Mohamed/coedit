import { Router } from 'express';
import type { AppDeps } from '../http/context.js';
import { requireUser } from '../auth/middleware.js';
import { requireAccess } from '../access.js';
import { notFound } from '../errors.js';
import { rateLimit } from '../http/rate-limit.js';
import { param } from '../http/params.js';
import { notifyDocument } from '../http/notify.js';
import {
  createDocument,
  deleteDocument,
  getDocumentStats,
  listOwnedDocuments,
  toDetailDto,
  toSummaryDto,
  updateDocumentTitle,
} from '../repositories/documents.js';
import { createDocumentSchema, updateDocumentSchema } from '../validation.js';

export function documentRoutes(deps: AppDeps): Router {
  const router = Router();
  const writeLimit = rateLimit('documents-write', 120, 60 * 1000);

  router.get('/documents', async (req, res) => {
    const user = requireUser(req);
    const rows = await listOwnedDocuments(deps.pool, user.id);
    res.json({
      documents: rows.map((row) =>
        toSummaryDto(row, 'owner', {
          commentCount: Number(row.comment_count),
          snapshotCount: Number(row.snapshot_count),
        }),
      ),
    });
  });

  router.post('/documents', writeLimit, async (req, res) => {
    const user = requireUser(req);
    const body = createDocumentSchema.parse(req.body ?? {});
    const row = await createDocument(deps.pool, user.id, body.title);
    res.status(201).json({
      document: toDetailDto(row, 'owner', { commentCount: 0, snapshotCount: 0 }),
    });
  });

  router.get('/documents/:id', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'read');
    const stats = await getDocumentStats(deps.pool, access.document.id);
    res.json({ document: toDetailDto(access.document, access.role, stats) });
  });

  router.patch('/documents/:id', writeLimit, async (req, res) => {
    const body = updateDocumentSchema.parse(req.body ?? {});
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'edit');
    const row = await updateDocumentTitle(deps.pool, access.document.id, body.title);
    if (!row) throw notFound('Document not found');
    const stats = await getDocumentStats(deps.pool, row.id);
    await notifyDocument(deps, row.id, { type: 'title-changed', title: row.title });
    res.json({ document: toDetailDto(row, access.role, stats) });
  });

  router.delete('/documents/:id', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'manage');
    await deleteDocument(deps.pool, access.document.id);
    await deps.rooms.shutdown(access.document.id, 4404, 'Document deleted');
    res.json({ ok: true });
  });

  return router;
}
