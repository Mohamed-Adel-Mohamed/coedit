/**
 * Roles and capability checks shared by the API, the realtime gateway and the web UI.
 *
 * There are two role ladders:
 *  - `DocRole`   — what the caller can do to one document (owner, editor, commenter, viewer)
 *  - `ShareRole` — what a share link grants (editor, commenter, viewer)
 *
 * The server is the only authority: the UI uses these helpers to avoid offering actions
 * that would be rejected, never to grant them.
 */
export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type ShareRole = 'editor' | 'commenter' | 'viewer';

export const SHARE_ROLES: readonly ShareRole[] = ['viewer', 'commenter', 'editor'];

const RANK: Record<DocRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export const ROLE_LABELS: Record<DocRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<ShareRole, string> = {
  viewer: 'Can read and follow along. No edits, no comments.',
  commenter: 'Can read and leave comments. Cannot change the document.',
  editor: 'Can edit the document and leave comments.',
};

export function isShareRole(value: unknown): value is ShareRole {
  return typeof value === 'string' && (SHARE_ROLES as readonly string[]).includes(value);
}

export function isDocRole(value: unknown): value is DocRole {
  return typeof value === 'string' && value in RANK;
}

/** Owners and editors may write to the CRDT. */
export function canEdit(role: DocRole): boolean {
  return role === 'owner' || role === 'editor';
}

/** Owners, editors and commenters may create comments. Viewers are read-only. */
export function canComment(role: DocRole): boolean {
  return role === 'owner' || role === 'editor' || role === 'commenter';
}

/** Share links can be created, listed and revoked by owners and editors. */
export function canManageShares(role: DocRole): boolean {
  return role === 'owner' || role === 'editor';
}

/** Only owners can rename or delete the document itself. */
export function canManageDocument(role: DocRole): boolean {
  return role === 'owner';
}

/** Restoring a version rewrites content, so it follows the edit capability. */
export function canRestore(role: DocRole): boolean {
  return canEdit(role);
}

export function atLeast(role: DocRole, minimum: DocRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Deterministic, readable avatar colours for new accounts and guests. */
export const PRESENCE_COLORS: readonly string[] = [
  '#f97316',
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#facc15',
  '#60a5fa',
  '#fb7185',
  '#2dd4bf',
  '#c084fc',
];

export function pickPresenceColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]!;
}
