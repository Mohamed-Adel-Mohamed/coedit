import type { WsTicketDto } from '@coedit/shared';

export type EditorMode = 'account' | 'share';

export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = 'request_failed') {
    super(message);
    this.name = 'ClientApiError';
    this.status = status;
    this.code = code;
  }
}

/** Browser-side calls are proxied through Next so cookies stay httpOnly. */
export async function clientApi<T>(
  path: string,
  init: RequestInit = {},
  mode: EditorMode = 'account',
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  headers.set('x-coedit-mode', mode);

  const response = await fetch(`/api/proxy/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ClientApiError(
      response.status,
      error?.message ?? 'Request failed',
      error?.code ?? 'request_failed',
    );
  }
  return data as T;
}

export function fetchWsTicket(
  documentId: string,
  mode: EditorMode,
  guestName?: string | null,
): Promise<WsTicketDto> {
  return clientApi<WsTicketDto>(
    `/documents/${encodeURIComponent(documentId)}/ws-ticket`,
    { method: 'POST', body: JSON.stringify({ guestName: guestName ?? undefined }) },
    mode,
  );
}
