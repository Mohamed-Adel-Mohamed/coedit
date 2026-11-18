import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, SHARE_COOKIE, TOKEN_COOKIE } from '@/lib/api';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

/**
 * Same-origin BFF for the editor's client-side calls. It attaches the httpOnly
 * credential, chooses account vs. share auth explicitly, and never forwards
 * arbitrary client headers.
 */
async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return NextResponse.json(
      { error: { code: 'method_not_allowed', message: 'Method not allowed' } },
      { status: 405 },
    );
  }

  const { path } = await context.params;
  const segments = (path ?? []).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Missing API path' } },
      { status: 400 },
    );
  }

  const target = new URL(`${API_URL}/api/${segments.map(encodeURIComponent).join('/')}`);
  target.search = new URL(request.url).search;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const mode = request.headers.get('x-coedit-mode');
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const share = request.cookies.get(SHARE_COOKIE)?.value;

  if (mode === 'share') {
    if (share) headers.set('x-coedit-share', share);
  } else if (token) {
    headers.set('authorization', `Bearer ${token}`);
  } else if (share) {
    headers.set('x-coedit-share', share);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.text() : undefined;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
      cache: 'no-store',
    });
    const responseHeaders = new Headers();
    const upstreamType = upstream.headers.get('content-type');
    if (upstreamType) responseHeaders.set('content-type', upstreamType);
    responseHeaders.set('cache-control', 'no-store');
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'upstream_unavailable', message: 'The collaboration server is unreachable' } },
      { status: 502 },
    );
  }
}

export function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context);
}
export function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context);
}
export function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context);
}
export function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context);
}
