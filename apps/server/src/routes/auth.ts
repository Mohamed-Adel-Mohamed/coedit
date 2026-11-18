import { Router } from 'express';
import { pickPresenceColor, type AuthResponseDto } from '@coedit/shared';
import type { AppDeps } from '../http/context.js';
import { rateLimit } from '../http/rate-limit.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/tokens.js';
import { requireUser } from '../auth/middleware.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  isUniqueViolation,
  toUserDto,
} from '../repositories/users.js';
import { loginSchema, registerSchema, sanitizeDisplayName } from '../validation.js';

export function authRoutes(deps: AppDeps): Router {
  const router = Router();

  router.post('/auth/register', rateLimit('register', 20, 60 * 60 * 1000), async (req, res) => {
    const body = registerSchema.parse(req.body);
    const displayName = sanitizeDisplayName(body.displayName, '');
    if (!displayName) throw badRequest('Please add a display name');

    const existing = await findUserByEmail(deps.pool, body.email);
    if (existing) throw conflict('An account with that email already exists');

    try {
      const row = await createUser(deps.pool, {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName,
        color: pickPresenceColor(body.email),
      });
      const token = await signAccessToken({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
      });
      const payload: AuthResponseDto = { token, user: toUserDto(row) };
      res.status(201).json(payload);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('An account with that email already exists');
      throw error;
    }
  });

  router.post('/auth/login', rateLimit('login', 30, 10 * 60 * 1000), async (req, res) => {
    const body = loginSchema.parse(req.body);
    const row = await findUserByEmail(deps.pool, body.email);
    if (!row) throw unauthorized('Email or password is incorrect');
    const valid = await verifyPassword(body.password, row.password_hash);
    if (!valid) throw unauthorized('Email or password is incorrect');

    const token = await signAccessToken({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
    });
    const payload: AuthResponseDto = { token, user: toUserDto(row) };
    res.json(payload);
  });

  router.get('/auth/me', async (req, res) => {
    const session = requireUser(req);
    const row = await findUserById(deps.pool, session.id);
    if (!row) throw unauthorized('Session no longer valid');
    res.json({ user: toUserDto(row) });
  });

  return router;
}
