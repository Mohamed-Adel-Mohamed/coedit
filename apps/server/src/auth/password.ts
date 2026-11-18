import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/** Format: scrypt$N$r$p$<salt b64>$<derived key b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  try {
    const salt = Buffer.from(rawSalt!, 'base64');
    const expected = Buffer.from(rawHash!, 'base64');
    if (expected.length === 0 || salt.length === 0) return false;
    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
