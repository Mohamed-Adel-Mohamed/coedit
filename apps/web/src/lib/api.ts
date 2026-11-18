import { cookies } from 'next/headers';
import type { UserDto } from '@coedit/shared';

export const TOKEN_COOKIE = 'coedit_token';
export const SHARE_COOKIE = 'coedit_share';
export const GUEST_COOKIE = 'coedit_guest';

export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8787';

export type AuthMode = 'auto' | 'account' | 'share' | 'none';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = 'request_failed') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Server-side API call. The browser never talks to the collaboration API directly;
 * it goes through this BFF layer, which is where the httpOnly cookies stay.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { auth?: AuthMode } = {},
): Promise<T> {
  const jar = await cookies();
  const mode = options.auth ?? 'auto';
  const headers = new Headers(init.headers);

  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const token = jar.get(TOKEN_COOKIE)?.value;
  const share = jar.get(SHARE_COOKIE)?.value;

  if (mode === 'share') {
    if (share) headers.set('x-coedit-share', share);
  } else if (mode === 'account') {
    if (token) headers.set('authorization', `Bearer ${token}`);
  } else if (mode === 'auto') {
    if (token) headers.set('authorization', `Bearer ${token}`);
    else if (share) headers.set('x-coedit-share', share);
  }

  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.message ?? 'The collaboration server rejected that request',
      error?.code ?? 'request_failed',
    );
  }
  return data as T;
}

export async function getCurrentUser(): Promise<UserDto | null> {
  const jar = await cookies();
  if (!jar.get(TOKEN_COOKIE)?.value) return null;
  try {
    const { user } = await apiFetch<{ user: UserDto }>('/auth/me', {}, { auth: 'account' });
    return user;
  } catch {
    return null;
  }
}

export async function hasAccountCookie(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(TOKEN_COOKIE)?.value);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
