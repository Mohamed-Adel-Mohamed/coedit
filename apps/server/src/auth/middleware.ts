import type { Request, RequestHandler } from 'express';
import type { Db } from '../db.js';
import { findUserById } from '../repositories/users.js';
import { verifyAccessToken } from './tokens.js';
import { unauthorized } from '../errors.js';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  color: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** Attaches `req.user` when a valid Bearer token is present. Never rejects by itself. */
export function authenticate(pool: Db): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        next();
        return;
      }
      const claims = await verifyAccessToken(header.slice('Bearer '.length).trim());
      if (!claims) {
        next();
        return;
      }
      const row = await findUserById(pool, claims.userId);
      if (row) {
        req.user = {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          color: row.color,
        };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const value = header.slice('Bearer '.length).trim();
  return value.length > 0 ? value : null;
}

export function shareTokenFromRequest(req: Request): string | null {
  const raw = req.headers['x-coedit-share'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
