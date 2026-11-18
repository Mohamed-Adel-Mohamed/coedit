import { Router } from 'express';
import type { ShareContextDto } from '@coedit/shared';
import type { AppDeps } from '../http/context.js';
import { requireAccess } from '../access.js';
import { forbidden, gone, notFound } from '../errors.js';
import { param } from '../http/params.js';
import { rateLimit } from '../http/rate-limit.js';
import { getDocument } from '../repositories/documents.js';
import {
  createShareLink,
  findActiveShareByToken,
  findShareByToken,
  isShareActive,
  listShareLinks,
  revokeShareLink,
  toCreatedShareDto,
  toShareDto,
} from '../repositories/shares.js';
import { createShareToken, hashShareToken } from '../auth/tokens.js';
import { createShareSchema } from '../validation.js';

export function shareRoutes(deps: AppDeps): Router {
  const router = Router();

  router.post('/documents/:id/shares', rateLimit('shares-write', 60, 60 * 1000), async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'shares');
    if (access.isGuest || !access.user) {
      throw forbidden('Share links can only be managed from an account');
    }
    const body = createShareSchema.parse(req.body ?? {});
    const token = createShareToken();
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const row = await createShareLink(deps.pool, {
      documentId: access.document.id,
      tokenHash: hashShareToken(token),
      tokenHint: token.slice(-6),
      role: body.role,
      label: body.label,
      createdBy: access.user.id,
      expiresAt,
    });
    res.status(201).json({ share: toCreatedShareDto(row, token) });
  });

  router.get('/documents/:id/shares', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'shares');
    if (access.isGuest) throw forbidden('Share links can only be managed from an account');
    const rows = await listShareLinks(deps.pool, access.document.id);
    res.json({ shares: rows.map(toShareDto) });
  });

  router.delete('/documents/:id/shares/:shareId', async (req, res) => {
    const access = await requireAccess(deps.pool, req, param(req, 'id'), 'shares');
    if (access.isGuest) throw forbidden('Share links can only be managed from an account');
    const row = await revokeShareLink(deps.pool, access.document.id, param(req, 'shareId'));
    if (!row) throw notFound('Share link not found');
    res.json({ share: toShareDto(row) });
  });

  router.get(
    '/shares/:token/context',
    rateLimit('share-context', 180, 60 * 1000),
    async (req, res) => {
      const token = param(req, 'token');
      if (token.length < 20 || token.length > 200) throw notFound('Share link not found');

      const hash = hashShareToken(token);
      const row = await findActiveShareByToken(deps.pool, hash);
      if (!row) {
        const inactive = await findShareByToken(deps.pool, hash);
        if (inactive && !isShareActive(inactive)) {
          throw gone('This share link has expired or was revoked');
        }
        throw notFound('Share link not found');
      }

      const document = await getDocument(deps.pool, row.document_id);
      if (!document) throw notFound('Document not found');

      const payload: ShareContextDto = {
        documentId: document.id,
        title: document.title,
        role: row.role,
        expiresAt: row.expires_at?.toISOString() ?? null,
        ownerName: document.owner_name,
        requiresGuestName: true,
      };
      res.json({ share: payload });
    },
  );

  return router;
}
