import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { tooManyRequests } from '../errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Small fixed-window limiter for credential and capability endpoints. In-memory by
 * design: at scale this moves to Redis next to the shared pub/sub bus.
 */
export function rateLimit(
  name: string,
  max: number,
  windowMs: number,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${name}:${ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      next(tooManyRequests());
      return;
    }
    next();
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
