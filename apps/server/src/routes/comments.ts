import { Router } from 'express';
import { canEdit } from '@coedit/shared';
import type { AppDeps } from '../http/context.js';
import { requireAccess } from '../access.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { param } from '../http/params.js';
import { rateLimit } from '../http/rate-limit.js';
import { notifyDocument } from '../http/notify.js';
import {
  createComment,
  deleteComment,
  getComment,
  listComments,
  setCommentResolved,
  toCommentDto,
} from '../repositories/comments.js';
import { createCommentSchema, sanitizeDisplayName, updateCommentSchema } from '../validation.js';

export function commentRoutes(deps: AppDeps): Router {
  const router = Router();
  const writeLimit = rateLimit('comments-write', 90, 60 * 1000);

  router.get('/documents/:id/comments', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'read');
    const rows = await listComments(deps.pool, access.document.id);
    res.json({ comments: rows.map(toCommentDto) });
  });

  router.post('/documents/:id/comments', writeLimit, async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'comment');
    const body = createCommentSchema.parse(req.body ?? {});

    const anchorFrom = body.anchorFrom ?? null;
    const anchorTo = body.anchorTo ?? null;
    if (anchorFrom !== null && anchorTo !== null && anchorFrom > anchorTo) {
      throw badRequest('The comment anchor is inverted');
    }
    const quote = body.anchorQuote?.trim().slice(0, 600) ?? null;

    const row = await createComment(deps.pool, {
      documentId: access.document.id,
      authorId: access.user?.id ?? null,
      authorName: access.user?.displayName ?? sanitizeDisplayName(body.guestName, 'Guest'),
      isGuest: access.isGuest,
      body: body.body,
      anchorQuote: quote,
      anchorFrom,
      anchorTo,
    });
    await notifyDocument(deps, access.document.id, { type: 'comments-changed' });
    res.status(201).json({ comment: toCommentDto(row) });
  });

  router.patch('/comments/:commentId', writeLimit, async (req, res) => {
    const existing = await getComment(deps.pool, param(req, 'commentId'));
    if (!existing) throw notFound('Comment not found');
    const body = updateCommentSchema.parse(req.body ?? {});
    const access = await requireAccess(deps.pool, req, existing.document_id, 'comment');
    const row = await setCommentResolved(deps.pool, existing.id, body.resolved);
    if (!row) throw notFound('Comment not found');
    await notifyDocument(deps, access.document.id, { type: 'comments-changed' });
    res.json({ comment: toCommentDto(row) });
  });

  router.delete('/comments/:commentId', async (req, res) => {
    const existing = await getComment(deps.pool, param(req, 'commentId'));
    if (!existing) throw notFound('Comment not found');
    const access = await requireAccess(deps.pool, req, existing.document_id, 'read');

    const isAuthor = access.user !== null && existing.author_id === access.user.id;
    if (!canEdit(access.role) && !isAuthor) {
      throw forbidden('Only the author or an editor can delete this comment');
    }
    await deleteComment(deps.pool, existing.id);
    await notifyDocument(deps, access.document.id, { type: 'comments-changed' });
    res.json({ ok: true });
  });

  return router;
}
