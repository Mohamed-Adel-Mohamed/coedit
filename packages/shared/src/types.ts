import type { DocRole, ShareRole } from './roles.js';

/** Wire shapes returned by the REST API. Timestamps are ISO-8601 strings. */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  color: string;
  createdAt: string;
}

export interface DocumentSummaryDto {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  role: DocRole;
  commentCount: number;
  snapshotCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetailDto extends DocumentSummaryDto {}

export type SnapshotKind = 'auto' | 'manual' | 'pre-restore';

export interface SnapshotSummaryDto {
  id: string;
  label: string;
  kind: SnapshotKind;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  sizeBytes: number;
}

export interface SnapshotDetailDto extends SnapshotSummaryDto {
  content: string;
}

export interface CommentDto {
  id: string;
  documentId: string;
  body: string;
  anchorQuote: string | null;
  anchorFrom: number | null;
  anchorTo: number | null;
  resolved: boolean;
  authorId: string | null;
  authorName: string;
  isGuest: boolean;
  createdAt: string;
}

export interface ShareLinkDto {
  id: string;
  role: ShareRole;
  label: string;
  tokenHint: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Returned only once, at creation time — the raw token is never stored. */
export interface CreatedShareLinkDto extends ShareLinkDto {
  token: string;
}

export interface ShareContextDto {
  documentId: string;
  title: string;
  role: ShareRole;
  expiresAt: string | null;
  ownerName: string;
  requiresGuestName: boolean;
}

export interface WsTicketDto {
  ticket: string;
  /** Absolute or path-relative websocket endpoint, e.g. `/ws`. */
  wsPath: string;
  role: DocRole;
  expiresIn: number;
  canEdit: boolean;
  canComment: boolean;
  displayName: string;
  color: string;
}

export interface AuthResponseDto {
  token: string;
  user: UserDto;
}

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
