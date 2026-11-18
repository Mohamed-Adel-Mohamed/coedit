import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import type { DocumentDetailDto } from '@coedit/shared';

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const title = String(form.get('title') ?? '').trim();

  try {
    const data = await apiFetch<{ document: DocumentDetailDto }>(
      '/documents',
      {
        method: 'POST',
        body: JSON.stringify({ title: title || undefined }),
      },
      { auth: 'account' },
    );
    return NextResponse.redirect(new URL(`/documents/${data.document.id}`, request.url), 303);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return NextResponse.redirect(new URL('/login', request.url), 303);
    }
    const message = error instanceof ApiError ? error.message : 'Could not create the document';
    return NextResponse.redirect(
      new URL(`/documents?error=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }
}
