import type { Request } from 'express';
import {
  canComment,
  canEdit,
  canManageDocument,
  canManageShares,
  type DocRole,
} from '@coedit/shared';
import type { Db } from './db.js';
import type { DocumentRow } from './repositories/documents.js';
import { getDocument } from './repositories/documents.js';
import type { ShareLinkRow } from './repositories/shares.js';
import { findActiveShareByToken, touchShareLink } from './repositories/shares.js';
import { hashShareToken } from './auth/tokens.js';
import { shareTokenFromRequest, type SessionUser } from './auth/middleware.js';
import { forbidden, notFound } from './errors.js';
import { logger } from './logger.js';

export interface AccessContext {
  document: DocumentRow;
  role: DocRole;
  /** Set when the caller authenticated with an account. */
  user: SessionUser | null;
  isGuest: boolean;
  shareLink: ShareLinkRow | null;
}

export type Capability = 'read' | 'comment' | 'edit' | 'shares' | 'manage';

const CAPABILITY_CHECK: Record<Capability, (role: DocRole) => boolean> = {
  read: () => true,
  comment: canComment,
  edit: canEdit,
  shares: canManageShares,
  manage: canManageDocument,
};

/**
 * Resolves who the caller is for one document. An account owner always has `owner`;
 * a valid share token grants exactly the role stored on the link. No token, no access.
 */
export async function resolveAccess(
  pool: Db,
  req: Request,
  documentId: string,
): Promise<AccessContext | null> {
  const document = await getDocument(pool, documentId);
  if (!document) return null;

  if (req.user && document.owner_id === req.user.id) {
    return { document, role: 'owner', user: req.user, isGuest: false, shareLink: null };
  }

  const rawShareToken = shareTokenFromRequest(req);
  if (!rawShareToken) return null;

  const link = await findActiveShareByToken(pool, hashShareToken(rawShareToken));
  if (!link || link.document_id !== document.id) return null;

  void touchShareLink(pool, link.id).catch((error: unknown) => {
    logger.warn({ err: error, shareId: link.id }, 'failed to record share link usage');
  });

  return { document, role: link.role, user: null, isGuest: true, shareLink: link };
}

export async function requireAccess(
  pool: Db,
  req: Request,
  documentId: string,
  capability: Capability = 'read',
): Promise<AccessContext> {
  const access = await resolveAccess(pool, req, documentId);
  if (!access) throw notFound('Document not found');
  if (!CAPABILITY_CHECK[capability](access.role)) {
    throw forbidden(
      capability === 'edit'
        ? 'This link does not allow editing'
        : capability === 'comment'
          ? 'This link does not allow commenting'
          : 'You do not have permission to do that',
    );
  }
  return access;
}
