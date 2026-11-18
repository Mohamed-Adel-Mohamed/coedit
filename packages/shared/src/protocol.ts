import * as decoding from 'lib0/decoding';

/**
 * Wire protocol for the collaborative socket.
 *
 * Binary frames:
 *   [0][y-protocols/sync payload]        — CRDT sync (step1 / step2 / update)
 *   [1][y-protocols/awareness payload]   — presence + cursors
 *
 * Text frames carry JSON control messages (server → client lifecycle and hints).
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

export const PROTOCOL_VERSION = 1;

export interface ReadyControlMessage {
  type: 'ready';
  version: number;
  documentId: string;
  role: 'owner' | 'editor' | 'commenter' | 'viewer';
  canEdit: boolean;
  canComment: boolean;
  userId: string | null;
  displayName: string;
  color: string;
}

export interface ErrorControlMessage {
  type: 'error';
  code: 'read-only' | 'forbidden' | 'invalid-message' | 'server-error';
  message: string;
}

export interface CommentsChangedControlMessage {
  type: 'comments-changed';
}

export interface SnapshotsChangedControlMessage {
  type: 'snapshots-changed';
}

export interface TitleChangedControlMessage {
  type: 'title-changed';
  title: string;
}

export type ServerControlMessage =
  | ReadyControlMessage
  | ErrorControlMessage
  | CommentsChangedControlMessage
  | SnapshotsChangedControlMessage
  | TitleChangedControlMessage;

export type ClientControlMessage = { type: 'ping' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeControl(message: ServerControlMessage | ClientControlMessage): string {
  return JSON.stringify(message);
}

export function decodeControl(raw: string): ServerControlMessage | ClientControlMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      typeof (parsed as { type: unknown }).type === 'string'
    ) {
      return parsed as ServerControlMessage | ClientControlMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function controlToBytes(message: ServerControlMessage | ClientControlMessage): Uint8Array {
  return encoder.encode(encodeControl(message));
}

/**
 * Read the client IDs contained in an awareness update without mutating any state.
 * Used by the server to know which presence entries belong to a given socket.
 *
 * Layout: varUint(count), then per client: varUint(clientId), varUint(clock),
 * varString(JSON state).
 */
export function readAwarenessClientIds(update: Uint8Array): number[] {
  const ids: number[] = [];
  try {
    const decoderInstance = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoderInstance);
    for (let index = 0; index < count; index += 1) {
      const clientId = decoding.readVarUint(decoderInstance);
      decoding.readVarUint(decoderInstance); // clock
      decoding.readVarString(decoderInstance); // state JSON
      ids.push(clientId);
    }
  } catch {
    return ids;
  }
  return ids;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
