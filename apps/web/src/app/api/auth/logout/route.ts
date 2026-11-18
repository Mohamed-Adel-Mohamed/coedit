import { NextResponse } from 'next/server';
import { GUEST_COOKIE, SHARE_COOKIE, TOKEN_COOKIE } from '@/lib/api';

export async function POST(request: Request): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.delete(TOKEN_COOKIE);
  response.cookies.delete(SHARE_COOKIE);
  response.cookies.delete(GUEST_COOKIE);
  return response;
}
