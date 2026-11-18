import type { RawData, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { canComment, canEdit, type DocRole, type ServerControlMessage } from '@coedit/shared';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeControl,
  readAwarenessClientIds,
} from '@coedit/shared';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '../logger.js';
import {
  appendUpdate,
  insertSnapshot,
  latestSnapshot,
  listUpdatePayloads,
  type SnapshotRow,
} from '../repositories/snapshots.js';
import { getLastSequence, nextSequence } from '../repositories/documents.js';
import type { PubSub } from './pubsub.js';

export interface RoomClient {
  id: string;
  ws: WebSocket;
  role: DocRole;
  userId: string | null;
  displayName: string;
  color: string;
  canEdit: boolean;
  canComment: boolean;
  awarenessIds: Set<number>;
  isAlive: boolean;
}

export interface ServerOrigin {
  kind: 'server';
  authorId: string | null;
}

interface RoomDeps {
  pool: Db;
  pubsub: PubSub;
  instanceId: string;
  config: Config;
  logger: Logger;
  onIdle: (documentId: string, room: Room) => void;
}

type RoomMessage =
  | { origin: string; kind: 'update'; payload: string }
  | { origin: string; kind: 'awareness'; payload: string }
  | { origin: string; kind: 'control'; payload: string };

const CLOSE_REPLACED = 4000;

export function isRoomClient(origin: unknown): origin is RoomClient {
  return (
    typeof origin === 'object' &&
    origin !== null &&
    'ws' in origin &&
    'awarenessIds' in origin &&
    'canEdit' in origin
  );
}

function isServerOrigin(origin: unknown): origin is ServerOrigin {
  return typeof origin === 'object' && origin !== null && (origin as ServerOrigin).kind === 'server';
}

function rawToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * One live document: CRDT state, connected peers, presence and the write path to
 * PostgreSQL. Updates from local clients are broadcast, published to the bus and
 * appended to the log. Updates arriving from the bus are applied and relayed but
 * never re-published or re-persisted (the originating instance owns them).
 */
export class Room {
  readonly docId: string;
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly awareness: awarenessProtocol.Awareness;

  private readonly clients = new Map<WebSocket, RoomClient>();
  private readonly channel: string;
  private writeChain: Promise<void> = Promise.resolve();
  private updatesSinceSnapshot = 0;
  private lastSnapshotAt = Date.now();
  private lastSnapshotContent = '';
  private unsubscribe: (() => Promise<void>) | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private deniedAt = new Map<string, number>();

  private constructor(
    docId: string,
    private readonly deps: RoomDeps,
  ) {
    this.docId = docId;
    this.channel = `coedit:room:${docId}`;
    this.doc = new Y.Doc();
    this.text = this.doc.getText('content');
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
  }

  static async create(docId: string, deps: RoomDeps): Promise<Room> {
    const room = new Room(docId, deps);
    await room.load();
    return room;
  }

  private async load(): Promise<void> {
    const snapshot = await latestSnapshot(this.deps.pool, this.docId);
    if (snapshot) {
      Y.applyUpdate(this.doc, new Uint8Array(snapshot.state), 'load');
      this.lastSnapshotAt = snapshot.created_at.getTime();
      this.lastSnapshotContent = snapshot.content;
    }
    const updates = await listUpdatePayloads(this.deps.pool, this.docId);
    for (const update of updates) {
      Y.applyUpdate(this.doc, new Uint8Array(update), 'load');
    }
    this.doc.on('update', this.handleDocUpdate);
    this.unsubscribe = await this.deps.pubsub.subscribe(this.channel, (message) => {
      this.handleBusMessage(message);
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get connectedRoles(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const client of this.clients.values()) {
      counts[client.role] = (counts[client.role] ?? 0) + 1;
    }
    return counts;
  }

  addClient(client: RoomClient): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.clients.set(client.ws, client);

    this.sendControl(client.ws, {
      type: 'ready',
      version: 1,
      documentId: this.docId,
      role: client.role,
      canEdit: client.canEdit,
      canComment: client.canComment,
      userId: client.userId,
      displayName: client.displayName,
      color: client.color,
    });

    const stepOne = encoding.createEncoder();
    encoding.writeVarUint(stepOne, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(stepOne, this.doc);
    this.sendBinary(client.ws, encoding.toUint8Array(stepOne));

    const presentIds = [...this.awareness.getStates().keys()];
    if (presentIds.length > 0) {
      this.sendBinary(
        client.ws,
        this.awarenessFrame(
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, presentIds),
        ),
      );
    }
  }

  removeClient(client: RoomClient): void {
    if (!this.clients.delete(client.ws)) return;

    const ids = [...client.awarenessIds];
    if (ids.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, ids, 'disconnect');
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids);
      const frame = this.awarenessFrame(update);
      for (const ws of this.clients.keys()) this.sendBinary(ws, frame);
      void this.publish({ origin: this.deps.instanceId, kind: 'awareness', payload: toBase64(update) });
    }

    this.deniedAt.delete(client.id);
    if (this.clients.size === 0) this.scheduleIdle();
  }

  handleMessage(client: RoomClient, data: RawData, isBinary: boolean): void {
    if (this.closed) return;
    if (!isBinary) {
      // Text frames are reserved for client control messages; none are required today.
      return;
    }

    const bytes = rawToBytes(data);
    if (bytes.length === 0) return;
    const messageType = bytes[0];

    try {
      if (messageType === MESSAGE_SYNC) {
        this.handleSync(client, bytes.subarray(1));
      } else if (messageType === MESSAGE_AWARENESS) {
        this.handleAwareness(client, bytes.subarray(1));
      }
    } catch (error) {
      this.deps.logger.warn(
        { err: error, documentId: this.docId, clientId: client.id },
        'dropped malformed websocket message',
      );
      this.sendControl(client.ws, {
        type: 'error',
        code: 'invalid-message',
        message: 'That update could not be read',
      });
    }
  }

  private handleSync(client: RoomClient, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const syncType = decoding.readVarUint(decoder);

    if (syncType === syncProtocol.messageYjsSyncStep1) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncStep1(decoder, encoder, this.doc);
      this.sendBinary(client.ws, encoding.toUint8Array(encoder));
      return;
    }

    if (
      syncType === syncProtocol.messageYjsSyncStep2 ||
      syncType === syncProtocol.messageYjsUpdate
    ) {
      if (!client.canEdit) {
        this.denyWrite(client);
        return;
      }
      if (syncType === syncProtocol.messageYjsSyncStep2) {
        syncProtocol.readSyncStep2(decoder, this.doc, client);
      } else {
        syncProtocol.readUpdate(decoder, this.doc, client);
      }
    }
  }

  private handleAwareness(client: RoomClient, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const update = decoding.readVarUint8Array(decoder);
    const ids = readAwarenessClientIds(update);
    if (ids.length === 0) return;

    const firstAwareness = client.awarenessIds.size === 0;
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, client);

    // Presence identity is issued by the server (ticket), not by the client, so a
    // viewer cannot appear as the owner. Cursor/selection fields are preserved.
    let sawState = false;
    for (const id of ids) {
      const state = this.awareness.getStates().get(id) as
        | (Record<string, unknown> & { user?: unknown })
        | undefined;
      if (!state) continue;
      sawState = true;
      this.awareness.states.set(id, {
        ...state,
        user: {
          id: client.userId,
          name: client.displayName,
          color: client.color,
          role: client.role,
        },
      });
      client.awarenessIds.add(id);
    }
    if (!sawState) return;

    const sanitized = awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids);
    const frame = this.awarenessFrame(sanitized);
    for (const ws of this.clients.keys()) this.sendBinary(ws, frame);
    if (firstAwareness) {
      // The initial presence packet can race with the client's listener setup;
      // this replay guarantees the newcomer sees who is already here.
      const present = [...this.awareness.getStates().keys()];
      if (present.length > 0) {
        this.sendBinary(
          client.ws,
          this.awarenessFrame(
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, present),
          ),
        );
      }
    }
    void this.publish({
      origin: this.deps.instanceId,
      kind: 'awareness',
      payload: toBase64(sanitized),
    });
  }

  private denyWrite(client: RoomClient): void {
    const now = Date.now();
    const last = this.deniedAt.get(client.id) ?? 0;
    if (now - last < 2_000) return;
    this.deniedAt.set(client.id, now);
    this.sendControl(client.ws, {
      type: 'error',
      code: 'read-only',
      message: 'This link is read-only, so your edit was not applied',
    });
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === 'redis' || origin === 'load') return;

    const client = isRoomClient(origin) ? origin : null;
    const authorId = client
      ? client.userId
      : isServerOrigin(origin)
        ? origin.authorId
        : null;

    const frame = this.syncFrame(update);
    for (const [ws] of this.clients) {
      if (client && ws === client.ws) continue;
      this.sendBinary(ws, frame);
    }
    void this.publish({
      origin: this.deps.instanceId,
      kind: 'update',
      payload: toBase64(update),
    });

    this.enqueuePersist(update, authorId);
  };

  private enqueuePersist(update: Uint8Array, authorId: string | null): void {
    const copy = Uint8Array.from(update);
    this.writeChain = this.writeChain
      .then(async () => {
        const { seq } = await nextSequence(this.deps.pool, this.docId);
        await appendUpdate(this.deps.pool, {
          documentId: this.docId,
          seq,
          update: copy,
          authorId,
        });
        this.updatesSinceSnapshot += 1;
        await this.maybeAutoSnapshot();
      })
      .catch((error: unknown) => {
        this.deps.logger.error(
          { err: error, documentId: this.docId },
          'failed to persist document update',
        );
      });
  }

  private async maybeAutoSnapshot(): Promise<void> {
    const elapsed = Date.now() - this.lastSnapshotAt;
    const changed = this.text.toString() !== this.lastSnapshotContent;
    const due =
      changed &&
      (this.updatesSinceSnapshot >= this.deps.config.snapshotMaxUpdates ||
        (this.updatesSinceSnapshot > 0 && elapsed >= this.deps.config.snapshotIntervalMs));
    if (!due) return;
    await this.snapshotNow('auto', null, 'Autosave');
  }

  /** Encodes current state and writes it as a version. Caller must hold the write chain. */
  private async snapshotNow(
    kind: SnapshotRow['kind'],
    createdBy: string | null,
    label: string,
  ): Promise<SnapshotRow> {
    const state = Y.encodeStateAsUpdate(this.doc);
    const content = this.text.toString();
    const seq = await getLastSequence(this.deps.pool, this.docId);
    const row = await insertSnapshot(this.deps.pool, {
      documentId: this.docId,
      seq,
      state,
      content,
      label,
      kind,
      createdBy,
    });
    this.updatesSinceSnapshot = 0;
    this.lastSnapshotAt = Date.now();
    this.lastSnapshotContent = content;
    this.broadcastControl({ type: 'snapshots-changed' });
    return row;
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  async createSnapshot(createdBy: string | null, label: string): Promise<SnapshotRow> {
    await this.flush();
    return this.snapshotNow('manual', createdBy, label || 'Manual snapshot');
  }

  /**
   * Restoring is a normal CRDT edit: the live document is rewritten, which emits an
   * update every peer already knows how to merge. A pre-restore version is kept so
   * the action is reversible.
   */
  async restoreFromSnapshot(snapshot: SnapshotRow, actorId: string | null): Promise<void> {
    await this.flush();
    await this.snapshotNow('pre-restore', actorId, 'Before restore');
    const origin: ServerOrigin = { kind: 'server', authorId: actorId };
    this.doc.transact(() => {
      const length = this.text.length;
      if (length > 0) this.text.delete(0, length);
      if (snapshot.content.length > 0) this.text.insert(0, snapshot.content);
    }, origin);
    await this.flush();
    this.broadcastControl({ type: 'snapshots-changed' });
  }

  broadcastControl(message: ServerControlMessage): void {
    const raw = JSON.stringify(message);
    this.broadcastRawControl(raw);
    void this.publish({
      origin: this.deps.instanceId,
      kind: 'control',
      payload: raw,
    });
  }

  private broadcastRawControl(raw: string): void {
    for (const ws of this.clients.keys()) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(raw);
        } catch (error) {
          this.deps.logger.debug({ err: error }, 'control send failed');
        }
      }
    }
  }

  private handleBusMessage(message: string): void {
    if (this.closed) return;
    let parsed: RoomMessage;
    try {
      parsed = JSON.parse(message) as RoomMessage;
    } catch {
      return;
    }
    if (!parsed || parsed.origin === this.deps.instanceId) return;

    if (parsed.kind === 'control') {
      if (typeof parsed.payload === 'string') this.broadcastRawControl(parsed.payload);
      return;
    }
    if (typeof parsed.payload !== 'string') return;
    const bytes = fromBase64(parsed.payload);

    if (parsed.kind === 'update') {
      try {
        Y.applyUpdate(this.doc, bytes, 'redis');
      } catch (error) {
        this.deps.logger.warn({ err: error, documentId: this.docId }, 'remote update rejected');
        return;
      }
      const frame = this.syncFrame(bytes);
      for (const ws of this.clients.keys()) this.sendBinary(ws, frame);
      return;
    }

    if (parsed.kind === 'awareness') {
      try {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, bytes, 'redis');
      } catch (error) {
        this.deps.logger.warn({ err: error, documentId: this.docId }, 'remote awareness rejected');
        return;
      }
      const frame = this.awarenessFrame(bytes);
      for (const ws of this.clients.keys()) this.sendBinary(ws, frame);
    }
  }

  private async publish(message: RoomMessage): Promise<void> {
    try {
      await this.deps.pubsub.publish(this.channel, JSON.stringify(message));
    } catch (error) {
      this.deps.logger.warn({ err: error, documentId: this.docId }, 'pub/sub publish failed');
    }
  }

  private syncFrame(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  private awarenessFrame(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  private sendBinary(ws: WebSocket, frame: Uint8Array): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength), { binary: true });
    } catch (error) {
      this.deps.logger.debug({ err: error }, 'websocket send failed');
    }
  }

  private sendControl(ws: WebSocket, message: ServerControlMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      this.deps.logger.debug({ err: error }, 'websocket control send failed');
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.clients.size > 0) return;
      void this.close(true).then(() => this.deps.onIdle(this.docId, this));
    }, this.deps.config.roomIdleMs);
    this.idleTimer.unref?.();
  }

  /** Flushes, snapshots and detaches the room. Used by idle expiry and shutdown. */
  async close(takeSnapshot: boolean): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    try {
      await this.flush();
      if (
        takeSnapshot &&
        this.updatesSinceSnapshot > 0 &&
        this.text.toString() !== this.lastSnapshotContent &&
        Date.now() - this.lastSnapshotAt >= 10_000
      ) {
        await this.snapshotNow('auto', null, 'Session end');
      }
    } catch (error) {
      this.deps.logger.error({ err: error, documentId: this.docId }, 'room close failed');
    }
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    if (unsubscribe) await unsubscribe();
    for (const client of this.clients.values()) {
      try {
        client.ws.close(1001, 'Document session ended');
      } catch {
        /* already gone */
      }
    }
    this.clients.clear();
    clearInterval(this.awareness._checkInterval);
    this.doc.destroy();
  }

  /** Ends every socket immediately, e.g. because the document was deleted. */
  async shutdown(code: number, reason: string): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        client.ws.close(code, reason);
      } catch {
        /* already gone */
      }
    }
    await this.close(false);
  }

  /** Test helper: forcibly close a socket (used to exercise reconnect paths). */
  static readonly CLOSE_REPLACED = CLOSE_REPLACED;
}
