import { NextResponse } from 'next/server';
import { API_URL, SHARE_COOKIE, TOKEN_COOKIE, GUEST_COOKIE } from '@/lib/api';

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.redirect(
      new URL('/login?error=The+collaboration+server+is+not+reachable', request.url),
      303,
    );
  }

  const data = (await upstream.json().catch(() => null)) as
    | { token?: string; error?: { message?: string } }
    | null;

  if (!upstream.ok || !data?.token) {
    const message = data?.error?.message ?? 'Email or password is incorrect';
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }

  const response = NextResponse.redirect(new URL('/documents', request.url), 303);
  response.cookies.set(TOKEN_COOKIE, data.token, { ...COOKIE_BASE, maxAge: 60 * 60 * 12 });
  response.cookies.delete(SHARE_COOKIE);
  response.cookies.delete(GUEST_COOKIE);
  return response;
}
