import type { DocRole, DocumentDetailDto, DocumentSummaryDto } from '@coedit/shared';
import type { Db } from '../db.js';

export interface DocumentRow {
  id: string;
  owner_id: string;
  title: string;
  last_seq: string;
  created_at: Date;
  updated_at: Date;
  owner_name: string;
}

export interface DocumentStats {
  commentCount: number;
  snapshotCount: number;
}

const SELECT_DOCUMENT = `
  SELECT d.id, d.owner_id, d.title, d.last_seq, d.created_at, d.updated_at,
         u.display_name AS owner_name
  FROM documents d
  JOIN users u ON u.id = d.owner_id
`;

export async function createDocument(
  pool: Db,
  ownerId: string,
  title: string,
): Promise<DocumentRow> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO documents (owner_id, title) VALUES ($1, $2) RETURNING id`,
    [ownerId, title],
  );
  const row = await getDocument(pool, inserted.rows[0]!.id);
  if (!row) throw new Error('Document vanished after insert');
  return row;
}

export async function getDocument(pool: Db, id: string): Promise<DocumentRow | null> {
  if (!isUuid(id)) return null;
  const result = await pool.query<DocumentRow>(`${SELECT_DOCUMENT} WHERE d.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listOwnedDocuments(
  pool: Db,
  ownerId: string,
): Promise<Array<DocumentRow & { comment_count: string; snapshot_count: string }>> {
  const result = await pool.query<DocumentRow & { comment_count: string; snapshot_count: string }>(
    `SELECT d.id, d.owner_id, d.title, d.last_seq, d.created_at, d.updated_at,
            u.display_name AS owner_name,
            (SELECT count(*) FROM comments c WHERE c.document_id = d.id) AS comment_count,
            (SELECT count(*) FROM snapshots s WHERE s.document_id = d.id) AS snapshot_count
     FROM documents d
     JOIN users u ON u.id = d.owner_id
     WHERE d.owner_id = $1
     ORDER BY d.updated_at DESC
     LIMIT 200`,
    [ownerId],
  );
  return result.rows;
}

export async function updateDocumentTitle(
  pool: Db,
  id: string,
  title: string,
): Promise<DocumentRow | null> {
  const result = await pool.query<{ id: string }>(
    `UPDATE documents SET title = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [id, title],
  );
  if (result.rowCount === 0) return null;
  return getDocument(pool, id);
}

export async function deleteDocument(pool: Db, id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM documents WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Allocates the next per-document update sequence and bumps recency. */
export async function nextSequence(
  pool: Db,
  documentId: string,
): Promise<{ seq: number; lastSeq: number; updatedAt: Date }> {
  const result = await pool.query<{ last_seq: string; updated_at: Date }>(
    `UPDATE documents SET last_seq = last_seq + 1, updated_at = now()
     WHERE id = $1 RETURNING last_seq, updated_at`,
    [documentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Document ${documentId} no longer exists`);
  const lastSeq = Number(row.last_seq);
  return { seq: lastSeq, lastSeq, updatedAt: row.updated_at };
}

export async function getLastSequence(pool: Db, documentId: string): Promise<number> {
  const result = await pool.query<{ last_seq: string }>(
    'SELECT last_seq FROM documents WHERE id = $1',
    [documentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Document ${documentId} no longer exists`);
  return Number(row.last_seq);
}

export async function getDocumentStats(pool: Db, id: string): Promise<DocumentStats> {
  const result = await pool.query<{ comment_count: string; snapshot_count: string }>(
    `SELECT
       (SELECT count(*) FROM comments WHERE document_id = $1) AS comment_count,
       (SELECT count(*) FROM snapshots WHERE document_id = $1) AS snapshot_count`,
    [id],
  );
  const row = result.rows[0];
  return {
    commentCount: Number(row?.comment_count ?? 0),
    snapshotCount: Number(row?.snapshot_count ?? 0),
  };
}

export function toSummaryDto(
  row: DocumentRow,
  role: DocRole,
  stats: DocumentStats,
): DocumentSummaryDto {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    role,
    commentCount: stats.commentCount,
    snapshotCount: stats.snapshotCount,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toDetailDto(
  row: DocumentRow,
  role: DocRole,
  stats: DocumentStats,
): DocumentDetailDto {
  return {
    ...toSummaryDto(row, role, stats),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
