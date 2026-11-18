import type { SnapshotDetailDto, SnapshotKind, SnapshotSummaryDto } from '@coedit/shared';
import type { Db } from '../db.js';

export interface SnapshotRow {
  id: string;
  document_id: string;
  seq: string;
  state: Buffer;
  content: string;
  label: string;
  kind: SnapshotKind;
  created_by: string | null;
  created_at: Date;
  created_by_name: string | null;
}

const SELECT_SNAPSHOT = `
  SELECT s.id, s.document_id, s.seq, s.state, s.content, s.label, s.kind,
         s.created_by, s.created_at, u.display_name AS created_by_name
  FROM snapshots s
  LEFT JOIN users u ON u.id = s.created_by
`;

export async function insertSnapshot(
  pool: Db,
  input: {
    documentId: string;
    seq: number;
    state: Uint8Array;
    content: string;
    label: string;
    kind: SnapshotKind;
    createdBy: string | null;
  },
): Promise<SnapshotRow> {
  const result = await pool.query<SnapshotRow>(
    `INSERT INTO snapshots (document_id, seq, state, content, label, kind, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, document_id, seq, state, content, label, kind, created_by, created_at,
               NULL::text AS created_by_name`,
    [
      input.documentId,
      input.seq,
      Buffer.from(input.state),
      input.content,
      input.label,
      input.kind,
      input.createdBy,
    ],
  );
  return result.rows[0]!;
}

export async function listSnapshots(
  pool: Db,
  documentId: string,
  limit = 100,
): Promise<SnapshotRow[]> {
  const result = await pool.query<SnapshotRow>(
    `${SELECT_SNAPSHOT} WHERE s.document_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT $2`,
    [documentId, limit],
  );
  return result.rows;
}

export async function getSnapshot(
  pool: Db,
  documentId: string,
  snapshotId: string,
): Promise<SnapshotRow | null> {
  const result = await pool.query<SnapshotRow>(
    `${SELECT_SNAPSHOT} WHERE s.document_id = $1 AND s.id = $2 LIMIT 1`,
    [documentId, snapshotId],
  );
  return result.rows[0] ?? null;
}

export async function latestSnapshot(pool: Db, documentId: string): Promise<SnapshotRow | null> {
  const result = await pool.query<SnapshotRow>(
    `${SELECT_SNAPSHOT} WHERE s.document_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    [documentId],
  );
  return result.rows[0] ?? null;
}

export async function countSnapshots(pool: Db, documentId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*) FROM snapshots WHERE document_id = $1',
    [documentId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * The full update log. Updates are idempotent in Yjs, so replaying an update that the
 * latest snapshot already contains is safe. The log is append-only; compaction is a
 * deliberate operational step (see docs/ARCHITECTURE.md), not an inline delete.
 */
export async function listUpdatePayloads(pool: Db, documentId: string): Promise<Buffer[]> {
  const result = await pool.query<{ update: Buffer }>(
    'SELECT update FROM doc_updates WHERE document_id = $1 ORDER BY seq ASC',
    [documentId],
  );
  return result.rows.map((row) => row.update);
}

export async function appendUpdate(
  pool: Db,
  input: {
    documentId: string;
    seq: number;
    update: Uint8Array;
    authorId: string | null;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO doc_updates (document_id, seq, author_id, update)
     VALUES ($1, $2, $3, $4)`,
    [input.documentId, input.seq, input.authorId, Buffer.from(input.update)],
  );
}

export function toSnapshotSummary(row: SnapshotRow): SnapshotSummaryDto {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    sizeBytes: row.state.length,
  };
}

export function toSnapshotDetail(row: SnapshotRow): SnapshotDetailDto {
  return { ...toSnapshotSummary(row), content: row.content };
}
