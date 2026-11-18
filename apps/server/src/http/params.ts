import type { Request } from 'express';
import { badRequest } from '../errors.js';

/** Express 5 types allow string[] for parameters; normalise to a single value. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0];
  throw badRequest(`Missing ${name}`);
}
