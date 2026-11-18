import { notFound, redirect } from 'next/navigation';
import type { DocumentDetailDto } from '@coedit/shared';
import { EditorWorkspace } from '@/components/editor/EditorWorkspace';
import { ApiError, apiFetch, getCurrentUser } from '@/lib/api';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let documentInfo: DocumentDetailDto;
  try {
    const data = await apiFetch<{ document: DocumentDetailDto }>(
      `/documents/${encodeURIComponent(id)}`,
      {},
      { auth: 'account' },
    );
    documentInfo = data.document;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    redirect('/documents');
  }

  const wsUrl =
    process.env.WS_URL ?? process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8787/ws';

  return (
    <EditorWorkspace
      documentInfo={documentInfo}
      mode="account"
      viewerName={user.displayName}
      viewerColor={user.color}
      userId={user.id}
      wsUrl={wsUrl}
    />
  );
}
