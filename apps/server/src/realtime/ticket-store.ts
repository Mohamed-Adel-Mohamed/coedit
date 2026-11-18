import type { Redis } from 'ioredis';
import { logger } from '../logger.js';

/**
 * Single-use storage for WebSocket ticket IDs. Memory works for one process; Redis
 * makes replay protection hold across a horizontally scaled deployment.
 */
export interface TicketStore {
  readonly kind: 'memory' | 'redis';
  /** Returns true only the first time a ticket id is seen. */
  consume(jti: string, expiresAtMs: number): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryTicketStore implements TicketStore {
  readonly kind = 'memory' as const;
  private readonly seen = new Map<string, number>();

  async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(key);
      else break;
    }
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expiresAtMs);
    return true;
  }

  async close(): Promise<void> {
    this.seen.clear();
  }
}

export class RedisTicketStore implements TicketStore {
  readonly kind = 'redis' as const;

  constructor(private readonly redis: Redis) {}

  async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    const ttl = Math.max(1_000, expiresAtMs - Date.now());
    try {
      const result = await this.redis.set(`coedit:ticket:${jti}`, '1', 'PX', ttl, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error({ err: error }, 'ticket store unavailable; rejecting ticket');
      return false;
    }
  }

  async close(): Promise<void> {
    /* shared connection is closed by the caller */
  }
}
