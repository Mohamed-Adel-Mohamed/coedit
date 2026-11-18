import type { Db } from '../db.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { PubSub } from './pubsub.js';
import { Room } from './room.js';

export interface RoomManagerOptions {
  pool: Db;
  pubsub: PubSub;
  instanceId: string;
  config: Config;
  logger: Logger;
}

/** Owns one Room per live document and deduplicates concurrent loads. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly pending = new Map<string, Promise<Room>>();

  constructor(private readonly options: RoomManagerOptions) {}

  async get(documentId: string): Promise<Room> {
    const existing = this.rooms.get(documentId);
    if (existing) return existing;

    const inFlight = this.pending.get(documentId);
    if (inFlight) return inFlight;

    const promise = Room.create(documentId, {
      ...this.options,
      onIdle: (id, room) => {
        if (this.rooms.get(id) === room) this.rooms.delete(id);
      },
    })
      .then((room) => {
        this.rooms.set(documentId, room);
        this.pending.delete(documentId);
        return room;
      })
      .catch((error: unknown) => {
        this.pending.delete(documentId);
        throw error;
      });

    this.pending.set(documentId, promise);
    return promise;
  }

  peek(documentId: string): Room | null {
    return this.rooms.get(documentId) ?? null;
  }

  get size(): number {
    return this.rooms.size;
  }

  async shutdown(documentId: string, code: number, reason: string): Promise<void> {
    const room = this.rooms.get(documentId);
    this.rooms.delete(documentId);
    if (room) await room.shutdown(code, reason);
  }

  async closeAll(): Promise<void> {
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    await Promise.allSettled(rooms.map((room) => room.close(true)));
  }
}
