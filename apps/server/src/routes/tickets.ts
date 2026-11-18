import { Router } from 'express';
import type { WsTicketDto } from '@coedit/shared';
import type { AppDeps } from '../http/context.js';
import { requireAccess } from '../access.js';
import { param } from '../http/params.js';
import { rateLimit } from '../http/rate-limit.js';
import { signWsTicket } from '../auth/tokens.js';
import { guestColor, sanitizeDisplayName, wsTicketSchema } from '../validation.js';

export function ticketRoutes(deps: AppDeps): Router {
  const router = Router();

  router.post(
    '/documents/:id/ws-ticket',
    rateLimit('ws-ticket', 120, 60 * 1000),
    async (req, res) => {
      const access = await requireAccess(deps.pool, req, param(req, 'id'), 'read');
      const body = wsTicketSchema.parse(req.body ?? {});

      const displayName = access.user
        ? access.user.displayName
        : sanitizeDisplayName(body.guestName, 'Guest');
      const color = access.user
        ? access.user.color
        : guestColor(`${access.shareLink?.id ?? 'guest'}:${displayName}`);

      const { ticket } = await signWsTicket({
        documentId: access.document.id,
        role: access.role,
        kind: access.isGuest ? 'guest' : 'user',
        userId: access.user?.id ?? null,
        displayName,
        color,
      });

      const payload: WsTicketDto = {
        ticket,
        wsPath: '/ws',
        role: access.role,
        expiresIn: deps.config.wsTicketTtlSeconds,
        canEdit: access.role === 'owner' || access.role === 'editor',
        canComment:
          access.role === 'owner' || access.role === 'editor' || access.role === 'commenter',
        displayName,
        color,
      };
      res.json(payload);
    },
  );

  return router;
}
