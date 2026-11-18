import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { logger } from '../logger.js';

export type PubSubHandler = (message: string) => void;

/**
 * Fan-out bus for document updates and presence between collaboration server
 * instances. `MemoryPubSub` is the zero-dependency local mode; `RedisPubSub` is used
 * whenever REDIS_URL is configured.
 */
export interface PubSub {
  readonly kind: 'memory' | 'redis';
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: PubSubHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export class MemoryPubSub implements PubSub {
  readonly kind = 'memory' as const;
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async publish(channel: string, message: string): Promise<void> {
    this.emitter.emit(channel, message);
  }

  async subscribe(channel: string, handler: PubSubHandler): Promise<() => Promise<void>> {
    this.emitter.on(channel, handler);
    return async () => {
      this.emitter.off(channel, handler);
    };
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

export class RedisPubSub implements PubSub {
  readonly kind = 'redis' as const;

  constructor(
    private readonly command: Redis,
    private readonly subscriber: Redis,
  ) {
    this.subscriber.on('error', (error) => {
      logger.error({ err: error }, 'redis subscriber error');
    });
    this.command.on('error', (error) => {
      logger.error({ err: error }, 'redis publisher error');
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.command.publish(channel, message);
    } catch (error) {
      logger.error({ err: error, channel }, 'redis publish failed');
    }
  }

  async subscribe(channel: string, handler: PubSubHandler): Promise<() => Promise<void>> {
    const listener = (incoming: string, payload: string): void => {
      if (incoming === channel) handler(payload);
    };
    this.subscriber.on('message', listener);
    try {
      await this.subscriber.subscribe(channel);
    } catch (error) {
      this.subscriber.off('message', listener);
      logger.error({ err: error, channel }, 'redis subscribe failed');
      return async () => undefined;
    }
    return async () => {
      this.subscriber.off('message', listener);
      try {
        await this.subscriber.unsubscribe(channel);
      } catch (error) {
        logger.warn({ err: error, channel }, 'redis unsubscribe failed');
      }
    };
  }

  async close(): Promise<void> {
    await this.subscriber.quit().catch(() => undefined);
    await this.command.quit().catch(() => undefined);
  }
}
