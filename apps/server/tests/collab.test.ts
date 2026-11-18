/**
 * Integration tests against a real PostgreSQL database and a real WebSocket server.
 * Requires the local dev cluster (npm run db:start); uses the `coedit_test` database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import type { AuthResponseDto, DocumentDetailDto, ShareRole, SnapshotDetailDto } from '@coedit/shared';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.COEDIT_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55433/coedit_test';
process.env.JWT_SECRET = 'integration-test-secret-0123456789abcdef0123456789';
process.env.AUTO_MIGRATE = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.ROOM_IDLE_MS = '60000';
process.env.SNAPSHOT_MAX_UPDATES = '1000';
process.env.SNAPSHOT_INTERVAL_MS = '3600000';
process.env.WS_TICKET_TTL_SECONDS = '90';
process.env.APP_ORIGINS = 'http://localhost:3000';

const { startServer } = await import('../src/server.js');
type RunningServer = Awaited<ReturnType<typeof startServer>>;

let server: RunningServer;
let baseUrl = '';
let wsUrl = '';

interface ApiResult<T> {
  status: number;
  data: T;
}

async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    share?: string;
  } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  if (options.share) headers.set('x-coedit-share', options.share);

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for condition');
}

async function register(email: string, displayName: string): Promise<AuthResponseDto> {
  const result = await api<AuthResponseDto>('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'Password123!', displayName },
  });
  expect(result.status).toBe(201);
  return result.data;
}

interface TestClient {
  doc: Y.Doc;
  text: Y.Text;
  awareness: awarenessProtocol.Awareness;
  controls: Array<{ type?: string; code?: string }>;
  closed: Promise<{ code: number; reason: string }>;
  close(): void;
}

async function connect(ticket: string, name = 'Tester'): Promise<TestClient> {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField('user', { name, color: '#22d3ee' });
  const controls: Array<{ type?: string; code?: string }> = [];
  const socket = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
  socket.binaryType = 'arraybuffer';

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  doc.on('update', (update, origin) => {
    if (origin === 'remote') return;
    if (socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, update);
    socket.send(encoding.toUint8Array(encoder));
  });

  awareness.on('update', (changes, origin) => {
    if (origin === 'remote') return;
    if (socket.readyState !== WebSocket.OPEN) return;
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    socket.send(encoding.toUint8Array(encoder));
  });

  socket.on('message', (data, isBinary) => {
    if (!isBinary) {
      const control = JSON.parse(data.toString()) as { type?: string; code?: string };
      controls.push(control);
      return;
    }
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const messageType = decoding.readVarUint(decoder);
    if (messageType === 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.readSyncMessage(decoder, encoder, doc, 'remote');
      if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
    } else if (messageType === 1) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        'remote',
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, 0);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  socket.send(encoding.toUint8Array(syncEncoder));

  const awarenessEncoder = encoding.createEncoder();
  encoding.writeVarUint(awarenessEncoder, 1);
  encoding.writeVarUint8Array(
    awarenessEncoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
  );
  socket.send(encoding.toUint8Array(awarenessEncoder));

  return {
    doc,
    text: doc.getText('content'),
    awareness,
    controls,
    closed,
    close: () => {
      socket.close();
      doc.destroy();
    },
  };
}

async function ticket(options: {
  documentId: string;
  token?: string;
  share?: string;
  guestName?: string;
}): Promise<{ status: number; data: { ticket?: string; role?: string; canEdit?: boolean } }> {
  return api(`/api/documents/${options.documentId}/ws-ticket`, {
    method: 'POST',
    body: { guestName: options.guestName },
    token: options.token,
    share: options.share,
  });
}

beforeAll(async () => {
  server = await startServer({ port: 0, redisUrl: null, autoMigrate: true });
  baseUrl = server.httpUrl;
  wsUrl = server.wsUrl;
  await server.deps.pool.query(
    'TRUNCATE comments, snapshots, doc_updates, share_links, documents, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await server.close();
});

describe('collaborative editing', () => {
  it('converges concurrent edits and persists them', async () => {
    const alice = await register('alice@test.dev', 'Alice Tester');
    const sam = await register('sam@test.dev', 'Sam Tester');

    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'Integration doc' },
      token: alice.token,
    });
    expect(created.status).toBe(201);
    const documentId = created.data.document.id;

    const share = await api<{ share: { token: string } }>(`/api/documents/${documentId}/shares`, {
      method: 'POST',
      body: { role: 'editor', label: 'integration' },
      token: alice.token,
    });
    expect(share.status).toBe(201);

    const ownerTicket = await ticket({ documentId, token: alice.token });
    const editorTicket = await ticket({
      documentId,
      share: share.data.share.token,
      guestName: 'Sam Guest',
    });
    expect(ownerTicket.status).toBe(200);
    expect(editorTicket.data.role).toBe('editor');
    expect(editorTicket.data.canEdit).toBe(true);

    const ownerClient = await connect(ownerTicket.data.ticket!);
    const editorClient = await connect(editorTicket.data.ticket!);

    ownerClient.text.insert(0, '# Shared draft\n');
    await waitFor(() => editorClient.text.toString().includes('# Shared draft'));

    editorClient.text.insert(editorClient.text.length, '\nWritten by a guest editor.');
    await waitFor(() => ownerClient.text.toString().includes('Written by a guest editor.'));

    await waitFor(async () => {
      const result = await server.deps.pool.query<{ count: string }>(
        'SELECT count(*) FROM doc_updates WHERE document_id = $1',
        [documentId],
      );
      return Number(result.rows[0]?.count ?? 0) >= 2;
    });

    const snapshot = await api<{ snapshot: { id: string; label: string } }>(
      `/api/documents/${documentId}/snapshots`,
      { method: 'POST', body: { label: 'Test checkpoint' }, token: alice.token },
    );
    expect(snapshot.status).toBe(201);

    const detail = await api<{ snapshot: SnapshotDetailDto }>(
      `/api/documents/${documentId}/snapshots/${snapshot.data.snapshot.id}`,
      { token: alice.token },
    );
    expect(detail.data.snapshot.content).toContain('# Shared draft');
    expect(detail.data.snapshot.content).toContain('guest editor');

    ownerClient.close();
    editorClient.close();
  });

  it('refuses document updates from a viewer and keeps the owner state intact', async () => {
    const alice = await register('viewer-owner@test.dev', 'Vera Owner');
    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'Read only doc' },
      token: alice.token,
    });
    const documentId = created.data.document.id;

    const share = await api<{ share: { token: string } }>(`/api/documents/${documentId}/shares`, {
      method: 'POST',
      body: { role: 'viewer' },
      token: alice.token,
    });

    const ownerTicket = await ticket({ documentId, token: alice.token });
    const viewerTicket = await ticket({
      documentId,
      share: share.data.share.token,
      guestName: 'Vince Viewer',
    });
    expect(viewerTicket.data.canEdit).toBe(false);

    const owner = await connect(ownerTicket.data.ticket!);
    const viewer = await connect(viewerTicket.data.ticket!);
    owner.text.insert(0, 'locked text');
    await waitFor(() => viewer.text.toString() === 'locked text');

    viewer.text.insert(0, 'HACK ');
    await waitFor(() => viewer.controls.some((control) => control.code === 'read-only'));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(owner.text.toString()).toBe('locked text');

    const persisted = await api<{ documents: DocumentDetailDto[] }>('/api/documents', {
      token: alice.token,
    });
    expect(persisted.data.documents[0]?.title).toBe('Read only doc');

    owner.close();
    viewer.close();
  });

  it('lets a commenter leave comments but not edits or share links', async () => {
    const alice = await register('comment-owner@test.dev', 'Cora Owner');
    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'Review doc' },
      token: alice.token,
    });
    const documentId = created.data.document.id;

    const share = await api<{ share: { token: string } }>(`/api/documents/${documentId}/shares`, {
      method: 'POST',
      body: { role: 'commenter' },
      token: alice.token,
    });
    const commenterToken = share.data.share.token;

    const comment = await api<{ comment: { authorName: string; isGuest: boolean; body: string } }>(
      `/api/documents/${documentId}/comments`,
      {
        method: 'POST',
        body: { body: 'This needs a source.', guestName: 'Casey Commenter', anchorQuote: 'Review' },
        share: commenterToken,
      },
    );
    expect(comment.status).toBe(201);
    expect(comment.data.comment.isGuest).toBe(true);
    expect(comment.data.comment.authorName).toBe('Casey Commenter');

    const forbiddenShare = await api<{ error: { code: string } }>(
      `/api/documents/${documentId}/shares`,
      { method: 'POST', body: { role: 'editor' }, share: commenterToken },
    );
    expect(forbiddenShare.status).toBe(403);

    const commenterTicket = await ticket({
      documentId,
      share: commenterToken,
      guestName: 'Casey Commenter',
    });
    const client = await connect(commenterTicket.data.ticket!);
    client.text.insert(0, 'should not apply');
    await waitFor(() => client.controls.some((control) => control.code === 'read-only'));

    const comments = await api<{ comments: Array<{ body: string }> }>(
      `/api/documents/${documentId}/comments`,
      { share: commenterToken },
    );
    expect(comments.data.comments).toHaveLength(1);
    client.close();
  });

  it('rejects ticket replay and unauthorized documents', async () => {
    const alice = await register('ticket-owner@test.dev', 'Tina Owner');
    const eve = await register('eve@test.dev', 'Eve Intruder');
    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'Private doc' },
      token: alice.token,
    });
    const documentId = created.data.document.id;

    const denied = await ticket({ documentId, token: eve.token });
    expect(denied.status).toBe(404);

    const issued = await ticket({ documentId, token: alice.token });
    expect(issued.status).toBe(200);

    const firstSocket = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(issued.data.ticket!)}`);
    const firstClose = new Promise<number>((resolve) => {
      firstSocket.on('close', (code) => resolve(code));
    });
    await new Promise<void>((resolve, reject) => {
      firstSocket.once('open', () => resolve());
      firstSocket.once('error', reject);
    });

    const secondSocket = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(issued.data.ticket!)}`);
    const secondCode = await new Promise<number>((resolve) => {
      secondSocket.on('close', (code) => resolve(code));
      secondSocket.on('error', () => resolve(-1));
    });
    expect(secondCode).toBe(4401);

    firstSocket.close();
    await firstClose;
  });

  it('revokes share links and rejects new tickets afterwards', async () => {
    const alice = await register('revoke-owner@test.dev', 'Rita Owner');
    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'Revocable doc' },
      token: alice.token,
    });
    const documentId = created.data.document.id;

    const share = await api<{ share: { id: string; token: string; role: ShareRole } }>(
      `/api/documents/${documentId}/shares`,
      { method: 'POST', body: { role: 'viewer' }, token: alice.token },
    );

    const before = await ticket({
      documentId,
      share: share.data.share.token,
      guestName: 'Guest',
    });
    expect(before.status).toBe(200);

    const revoke = await api(`/api/documents/${documentId}/shares/${share.data.share.id}`, {
      method: 'DELETE',
      token: alice.token,
    });
    expect(revoke.status).toBe(200);

    const after = await ticket({ documentId, share: share.data.share.token, guestName: 'Guest' });
    expect(after.status).toBe(404);

    const context = await api<{ error: { code: string } }>(
      `/api/shares/${share.data.share.token}/context`,
    );
    expect(context.status).toBe(410);
  });

  it('restores a snapshot for every connected peer and keeps a pre-restore version', async () => {
    const alice = await register('restore-owner@test.dev', 'Rhea Owner');
    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'History doc' },
      token: alice.token,
    });
    const documentId = created.data.document.id;

    const firstTicket = await ticket({ documentId, token: alice.token });
    const secondTicket = await ticket({ documentId, token: alice.token });
    const first = await connect(firstTicket.data.ticket!);
    const second = await connect(secondTicket.data.ticket!);

    first.text.insert(0, 'version one');
    await waitFor(() => second.text.toString() === 'version one');

    const snapshot = await api<{ snapshot: { id: string } }>(
      `/api/documents/${documentId}/snapshots`,
      { method: 'POST', body: { label: 'Version one' }, token: alice.token },
    );
    expect(snapshot.status).toBe(201);

    second.text.insert(second.text.length, ' — now edited');
    await waitFor(() => first.text.toString().includes('now edited'));

    const restore = await api(`/api/documents/${documentId}/snapshots/${snapshot.data.snapshot.id}/restore`, {
      method: 'POST',
      token: alice.token,
    });
    expect(restore.status).toBe(200);

    await waitFor(() => first.text.toString() === 'version one');
    await waitFor(() => second.text.toString() === 'version one');

    const history = await api<{ snapshots: Array<{ kind: string }> }>(
      `/api/documents/${documentId}/snapshots`,
      { token: alice.token },
    );
    const kinds = history.data.snapshots.map((entry) => entry.kind);
    expect(kinds).toContain('manual');
    expect(kinds).toContain('pre-restore');

    first.close();
    second.close();
  });

  it('keeps spoofed presence names off other clients', async () => {
    const alice = await register('presence-owner@test.dev', 'Real Alice');
    const created = await api<{ document: DocumentDetailDto }>('/api/documents', {
      method: 'POST',
      body: { title: 'Presence doc' },
      token: alice.token,
    });
    const documentId = created.data.document.id;
    const firstTicket = await ticket({ documentId, token: alice.token });
    const secondTicket = await ticket({ documentId, token: alice.token });

    const observer = await connect(firstTicket.data.ticket!, 'Observer');
    const real = await connect(secondTicket.data.ticket!, 'Real Alice');

    real.awareness.setLocalStateField('user', { name: 'Fake Owner', color: '#ff0000' });

    await waitFor(() =>
      [...observer.awareness.getStates().values()].some(
        (state) => (state as { user?: { name?: string } }).user?.name === 'Real Alice',
      ),
    );
    const names = [...observer.awareness.getStates().values()]
      .map((state) => (state as { user?: { name?: string } }).user?.name)
      .filter(Boolean);
    expect(names).not.toContain('Fake Owner');

    observer.close();
    real.close();
  });
});
