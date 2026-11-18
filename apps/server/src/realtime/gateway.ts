import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { Db } from '../db.js';
import { verifyWsTicket } from '../auth/tokens.js';
import type { TicketStore } from './ticket-store.js';
import type { RoomManager } from './rooms.js';
import type { RoomClient } from './room.js';
import { canComment, canEdit } from '@coedit/shared';

export interface RealtimeDeps {
  config: Config;
  logger: Logger;
  pool: Db;
  rooms: RoomManager;
  tickets: TicketStore;
}

const HEARTBEAT_MS = 30_000;

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Attaches the Yjs sync socket at /ws. A connection is admitted only with a valid,
 * unexpired, single-use ticket minted by the REST API for one document and role.
 */
export function attachRealtime(server: HttpServer, deps: RealtimeDeps): () => Promise<void> {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: deps.config.maxWsPayloadBytes,
    perMessageDeflate: false,
  });

  const liveness = new WeakMap<WebSocket, boolean>();

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (liveness.get(ws) === false) {
        ws.terminate();
        continue;
      }
      liveness.set(ws, false);
      try {
        ws.ping();
      } catch {
        /* socket already gone */
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rawUrl = request.url ?? '/';
    let url: URL;
    try {
      url = new URL(rawUrl, 'http://localhost');
    } catch {
      rejectUpgrade(socket, '400 Bad Request');
      return;
    }
    if (url.pathname !== '/ws') {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    const origin = request.headers.origin;
    if (origin && !deps.config.appOrigins.includes(origin)) {
      deps.logger.warn({ origin }, 'websocket origin rejected');
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    // Frames can arrive while the ticket is being validated and the room is loading.
    // Buffer them so a cold room cannot swallow the client's initial sync step.
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];
    const bufferFrame = (data: RawData, isBinary: boolean): void => {
      pending.push({ data, isBinary });
    };
    ws.on('message', bufferFrame);

    void (async () => {
      const url = new URL(request.url ?? '/ws', 'http://localhost');
      const ticket = url.searchParams.get('ticket');
      if (!ticket) {
        ws.close(4401, 'Missing ticket');
        return;
      }
      const claims = await verifyWsTicket(ticket);
      if (!claims) {
        ws.close(4401, 'Invalid or expired ticket');
        return;
      }
      const consumed = await deps.tickets.consume(claims.jti, claims.expiresAtMs);
      if (!consumed) {
        ws.close(4401, 'Ticket already used');
        return;
      }

      let room;
      try {
        room = await deps.rooms.get(claims.documentId);
      } catch (error) {
        deps.logger.error(
          { err: error, documentId: claims.documentId },
          'failed to open document room',
        );
        ws.close(1011, 'Could not load the document');
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) return;

      const client: RoomClient = {
        id: randomUUID(),
        ws,
        role: claims.role,
        userId: claims.userId,
        displayName: claims.displayName,
        color: claims.color,
        canEdit: canEdit(claims.role),
        canComment: canComment(claims.role),
        awarenessIds: new Set(),
        isAlive: true,
      };

      room.addClient(client);
      liveness.set(ws, true);

      ws.off('message', bufferFrame);
      ws.on('message', (data, isBinary) => {
        room.handleMessage(client, data, isBinary);
      });
      for (const frame of pending) {
        room.handleMessage(client, frame.data, frame.isBinary);
      }
      pending.length = 0;

      ws.on('pong', () => {
        liveness.set(ws, true);
        client.isAlive = true;
      });
      ws.on('error', (error) => {
        deps.logger.debug({ err: error, documentId: claims.documentId }, 'websocket error');
      });
      ws.on('close', () => {
        room.removeClient(client);
      });
    })().catch((error: unknown) => {
      deps.logger.error({ err: error }, 'websocket connection failed');
      try {
        ws.close(1011, 'Server error');
      } catch {
        /* already closed */
      }
    });
  });

  deps.logger.info({ path: '/ws' }, 'realtime gateway attached');

  return async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  };
}
