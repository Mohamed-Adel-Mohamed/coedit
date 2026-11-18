import type { CreatedShareLinkDto, ShareLinkDto, ShareRole } from '@coedit/shared';
import type { Db } from '../db.js';

export interface ShareLinkRow {
  id: string;
  document_id: string;
  token_hash: string;
  token_hint: string;
  role: ShareRole;
  label: string;
  created_by: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, document_id, token_hash, token_hint, role, label, created_by,
  expires_at, revoked_at, last_used_at, created_at`;

const ACTIVE = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;

export async function createShareLink(
  pool: Db,
  input: {
    documentId: string;
    tokenHash: string;
    tokenHint: string;
    role: ShareRole;
    label: string;
    createdBy: string;
    expiresAt: Date | null;
  },
): Promise<ShareLinkRow> {
  const result = await pool.query<ShareLinkRow>(
    `INSERT INTO share_links (document_id, token_hash, token_hint, role, label, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      input.documentId,
      input.tokenHash,
      input.tokenHint,
      input.role,
      input.label,
      input.createdBy,
      input.expiresAt,
    ],
  );
  return result.rows[0]!;
}

export async function findShareByToken(pool: Db, tokenHash: string): Promise<ShareLinkRow | null> {
  const result = await pool.query<ShareLinkRow>(
    `SELECT ${COLUMNS} FROM share_links WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function findActiveShareByToken(
  pool: Db,
  tokenHash: string,
): Promise<ShareLinkRow | null> {
  const result = await pool.query<ShareLinkRow>(
    `SELECT ${COLUMNS} FROM share_links WHERE token_hash = $1 AND ${ACTIVE} LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function listShareLinks(pool: Db, documentId: string): Promise<ShareLinkRow[]> {
  const result = await pool.query<ShareLinkRow>(
    `SELECT ${COLUMNS} FROM share_links WHERE document_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [documentId],
  );
  return result.rows;
}

export async function revokeShareLink(
  pool: Db,
  documentId: string,
  shareId: string,
): Promise<ShareLinkRow | null> {
  const result = await pool.query<ShareLinkRow>(
    `UPDATE share_links SET revoked_at = now()
     WHERE id = $1 AND document_id = $2 AND revoked_at IS NULL
     RETURNING ${COLUMNS}`,
    [shareId, documentId],
  );
  return result.rows[0] ?? null;
}

export async function touchShareLink(pool: Db, id: string): Promise<void> {
  await pool.query('UPDATE share_links SET last_used_at = now() WHERE id = $1', [id]);
}

export function isShareActive(row: ShareLinkRow): boolean {
  return row.revoked_at === null && (row.expires_at === null || row.expires_at.getTime() > Date.now());
}

export function toShareDto(row: ShareLinkRow): ShareLinkDto {
  return {
    id: row.id,
    role: row.role,
    label: row.label,
    tokenHint: row.token_hint,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

export function toCreatedShareDto(row: ShareLinkRow, token: string): CreatedShareLinkDto {
  return { ...toShareDto(row), token };
}
