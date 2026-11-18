import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await apiFetch(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }, { auth: 'account' });
  } catch {
    return NextResponse.redirect(
      new URL('/documents?error=Could+not+delete+that+document', request.url),
      303,
    );
  }
  return NextResponse.redirect(new URL('/documents', request.url), 303);
}
