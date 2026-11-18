import type { CommentDto } from '@coedit/shared';
import type { Db } from '../db.js';

export interface CommentRow {
  id: string;
  document_id: string;
  author_id: string | null;
  author_name: string;
  is_guest: boolean;
  body: string;
  anchor_quote: string | null;
  anchor_from: number | null;
  anchor_to: number | null;
  resolved_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, document_id, author_id, author_name, is_guest, body,
  anchor_quote, anchor_from, anchor_to, resolved_at, created_at`;

export async function listComments(pool: Db, documentId: string): Promise<CommentRow[]> {
  const result = await pool.query<CommentRow>(
    `SELECT ${COLUMNS} FROM comments WHERE document_id = $1
     ORDER BY resolved_at NULLS FIRST, created_at ASC LIMIT 500`,
    [documentId],
  );
  return result.rows;
}

export async function createComment(
  pool: Db,
  input: {
    documentId: string;
    authorId: string | null;
    authorName: string;
    isGuest: boolean;
    body: string;
    anchorQuote: string | null;
    anchorFrom: number | null;
    anchorTo: number | null;
  },
): Promise<CommentRow> {
  const result = await pool.query<CommentRow>(
    `INSERT INTO comments
       (document_id, author_id, author_name, is_guest, body, anchor_quote, anchor_from, anchor_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      input.documentId,
      input.authorId,
      input.authorName,
      input.isGuest,
      input.body,
      input.anchorQuote,
      input.anchorFrom,
      input.anchorTo,
    ],
  );
  return result.rows[0]!;
}

export async function getComment(pool: Db, commentId: string): Promise<CommentRow | null> {
  const result = await pool.query<CommentRow>(
    `SELECT ${COLUMNS} FROM comments WHERE id = $1 LIMIT 1`,
    [commentId],
  );
  return result.rows[0] ?? null;
}

export async function setCommentResolved(
  pool: Db,
  commentId: string,
  resolved: boolean,
): Promise<CommentRow | null> {
  const result = await pool.query<CommentRow>(
    `UPDATE comments SET resolved_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [commentId, resolved],
  );
  return result.rows[0] ?? null;
}

export async function deleteComment(pool: Db, commentId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
  return (result.rowCount ?? 0) > 0;
}

export function toCommentDto(row: CommentRow): CommentDto {
  return {
    id: row.id,
    documentId: row.document_id,
    body: row.body,
    anchorQuote: row.anchor_quote,
    anchorFrom: row.anchor_from,
    anchorTo: row.anchor_to,
    resolved: row.resolved_at !== null,
    authorId: row.author_id,
    authorName: row.author_name,
    isGuest: row.is_guest,
    createdAt: row.created_at.toISOString(),
  };
}
