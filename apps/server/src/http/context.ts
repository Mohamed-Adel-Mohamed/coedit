import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '../logger.js';
import type { PubSub } from '../realtime/pubsub.js';
import type { RoomManager } from '../realtime/rooms.js';
import type { TicketStore } from '../realtime/ticket-store.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
  pool: Db;
  pubsub: PubSub;
  rooms: RoomManager;
  tickets: TicketStore;
  instanceId: string;
}
