import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeControl,
  type ServerControlMessage,
  type WsTicketDto,
} from '@coedit/shared';
import { ClientApiError } from './client-api';

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'error' | 'stopped';

export interface CollabIdentity {
  name: string;
  color: string;
}

interface CollabSocketOptions {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  wsUrl: string;
  identity: CollabIdentity;
  getTicket: () => Promise<WsTicketDto>;
  onStatus: (status: ConnectionStatus, detail?: string) => void;
  onControl: (message: ServerControlMessage) => void;
  onTicket: (ticket: WsTicketDto) => void;
}

/**
 * Minimal Yjs websocket client: y-protocols sync + awareness, short-lived ticket
 * per connection, and exponential-backoff reconnects that fetch a fresh ticket.
 */
export class CollabSocket {
  private readonly doc: Y.Doc;
  private readonly awareness: awarenessProtocol.Awareness;
  private readonly options: CollabSocketOptions;
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handleUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly handleAwareness: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;

  constructor(options: CollabSocketOptions) {
    this.options = options;
    this.doc = options.doc;
    this.awareness = options.awareness;
    const current = this.awareness.getLocalState();
    this.awareness.setLocalState({
      ...(current ?? {}),
      user: {
        name: options.identity.name,
        color: options.identity.color,
      },
    });

    this.handleUpdate = (update, origin) => {
      if (origin === 'remote') return;
      this.sendUpdate(update);
    };
    this.handleAwareness = (changes, origin) => {
      if (origin === 'remote') return;
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (!changed.includes(this.doc.clientID)) return;
      this.sendLocalAwareness();
    };

    this.doc.on('update', this.handleUpdate);
    this.awareness.on('update', this.handleAwareness);
  }

  connect(): void {
    if (this.stopped || this.ws) return;
    void this.open();
  }

  destroy(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.doc.off('update', this.handleUpdate);
    this.awareness.off('update', this.handleAwareness);
    const remoteIds = [...this.awareness.getStates().keys()].filter(
      (id) => id !== this.doc.clientID,
    );
    if (remoteIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, remoteIds, 'remote');
    }
    this.awareness.setLocalState(null);
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onclose = null;
      socket.close();
    }
    this.options.onStatus('stopped');
  }

  private async open(): Promise<void> {
    this.options.onStatus('connecting');
    let ticket: WsTicketDto;
    try {
      ticket = await this.options.getTicket();
    } catch (error) {
      const fatal =
        error instanceof ClientApiError &&
        (error.status === 401 || error.status === 403 || error.status === 404);
      this.options.onStatus(
        'error',
        error instanceof Error ? error.message : 'Could not authorize the editor',
      );
      if (!fatal) this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    this.options.onTicket(ticket);

    // The ticket is authoritative for display identity; apply it before connecting so
    // every peer (and this client) shows the same name and colour.
    const current = this.awareness.getLocalState();
    this.awareness.setLocalState({
      ...(current ?? {}),
      user: { name: ticket.displayName, color: ticket.color, role: ticket.role },
    });

    const separator = this.options.wsUrl.includes('?') ? '&' : '?';
    const socket = new WebSocket(
      `${this.options.wsUrl}${separator}ticket=${encodeURIComponent(ticket.ticket)}`,
    );
    socket.binaryType = 'arraybuffer';
    this.ws = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.options.onStatus('connected');
      this.sendSyncStepOne();
      this.sendLocalAwareness();
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      this.ws = null;
      if (this.stopped) return;
      const remoteIds = [...this.awareness.getStates().keys()].filter(
        (id) => id !== this.doc.clientID,
      );
      if (remoteIds.length > 0) {
        awarenessProtocol.removeAwarenessStates(this.awareness, remoteIds, 'remote');
      }
      if (event.code === 4401) {
        this.options.onStatus(
          'error',
          'The connection ticket was rejected. Reconnecting with a fresh one…',
        );
        this.scheduleReconnect();
        return;
      }
      if (event.code === 4403 || event.code === 4404) {
        this.options.onStatus('error', event.reason || 'Access to this document ended');
        return;
      }
      this.options.onStatus('offline', 'Connection lost — reconnecting');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // `close` always follows; the status is reported there.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    const delay = Math.min(8_000, 500 * 2 ** Math.min(this.attempt, 4)) + Math.random() * 300;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) void this.open();
    }, delay);
  }

  private handleMessage(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const control = decodeControl(data);
      if (control && 'type' in control) {
        this.options.onControl(control as ServerControlMessage);
      }
      return;
    }

    try {
      const bytes = new Uint8Array(data);
      const decoder = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, 'remote');
        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder));
        }
        return;
      }

      if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'remote');
      }
    } catch {
      // A malformed frame must not take down the editor; the server will resync.
    }
  }

  private sendSyncStepOne(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private sendLocalAwareness(): void {
    const state = this.awareness.getLocalState();
    if (!state) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    );
    this.send(encoding.toUint8Array(encoder));
  }

  private send(frame: Uint8Array): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(frame);
  }
}
