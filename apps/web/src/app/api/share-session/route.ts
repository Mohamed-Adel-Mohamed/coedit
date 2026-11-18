import { NextResponse } from 'next/server';
import { API_URL, GUEST_COOKIE, SHARE_COOKIE } from '@/lib/api';

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const token = String(form.get('token') ?? '').trim();
  const rawName = String(form.get('name') ?? '');
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 40);
  const back = new URL(`/s/${encodeURIComponent(token)}`, request.url);

  if (!token || token.length < 20 || !name) {
    back.searchParams.set('error', 'Add a display name to join the document');
    return NextResponse.redirect(back, 303);
  }

  try {
    const upstream = await fetch(`${API_URL}/api/shares/${encodeURIComponent(token)}/context`, {
      cache: 'no-store',
    });
    if (!upstream.ok) {
      back.searchParams.set('error', 'This share link has expired or was revoked');
      return NextResponse.redirect(back, 303);
    }
  } catch {
    back.searchParams.set('error', 'The collaboration server is not reachable');
    return NextResponse.redirect(back, 303);
  }

  const response = NextResponse.redirect(back, 303);
  response.cookies.set(SHARE_COOKIE, token, { ...COOKIE_BASE, maxAge: 60 * 60 * 24 * 30 });
  response.cookies.set(GUEST_COOKIE, name, { ...COOKIE_BASE, maxAge: 60 * 60 * 24 * 30 });
  return response;
}
