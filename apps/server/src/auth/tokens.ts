import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { DocRole } from '@coedit/shared';
import { config } from '../config.js';

const secretKey = new TextEncoder().encode(config.jwtSecret);
const ISSUER = 'coedit';
const ACCESS_AUDIENCE = 'coedit-web';
const WS_AUDIENCE = 'coedit-ws';

export interface AccessTokenInput {
  id: string;
  email: string;
  displayName: string;
}

export interface WsTicketInput {
  documentId: string;
  role: DocRole;
  kind: 'user' | 'guest';
  userId: string | null;
  displayName: string;
  color: string;
}

export interface VerifiedWsTicket extends WsTicketInput {
  jti: string;
  expiresAtMs: number;
}

export async function signAccessToken(user: AccessTokenInput): Promise<string> {
  return new SignJWT({ email: user.email, name: user.displayName })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlHours}h`)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export async function signWsTicket(
  input: WsTicketInput,
): Promise<{ ticket: string; jti: string; expiresAtMs: number }> {
  const jti = randomUUID();
  const expiresAtMs = Date.now() + config.wsTicketTtlSeconds * 1000;
  const ticket = await new SignJWT({
    doc: input.documentId,
    role: input.role,
    kind: input.kind,
    uid: input.userId,
    name: input.displayName,
    color: input.color,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(WS_AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAtMs / 1000))
    .sign(secretKey);
  return { ticket, jti, expiresAtMs };
}

export async function verifyWsTicket(ticket: string): Promise<VerifiedWsTicket | null> {
  try {
    const { payload } = await jwtVerify(ticket, secretKey, {
      issuer: ISSUER,
      audience: WS_AUDIENCE,
      algorithms: ['HS256'],
    });
    const role = payload.role;
    const kind = payload.kind;
    const documentId = payload.doc;
    const jti = payload.jti;
    const displayName = payload.name;
    const color = payload.color;
    const userId = payload.uid;
    const exp = payload.exp;
    if (
      typeof documentId !== 'string' ||
      typeof jti !== 'string' ||
      typeof displayName !== 'string' ||
      typeof color !== 'string' ||
      typeof exp !== 'number' ||
      (kind !== 'user' && kind !== 'guest') ||
      (role !== 'owner' && role !== 'editor' && role !== 'commenter' && role !== 'viewer') ||
      (userId !== null && typeof userId !== 'string')
    ) {
      return null;
    }
    return {
      documentId,
      role,
      kind,
      userId,
      displayName,
      color,
      jti,
      expiresAtMs: exp * 1000,
    };
  } catch {
    return null;
  }
}

/** Share links carry 256 bits of entropy; only the SHA-256 hash is stored. */
export function createShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createTicketJti(): string {
  return randomUUID();
}
