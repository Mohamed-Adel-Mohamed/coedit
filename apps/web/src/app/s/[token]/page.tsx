import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ROLE_DESCRIPTIONS,
  pickPresenceColor,
  type DocumentDetailDto,
  type ShareContextDto,
} from '@coedit/shared';
import { Brand } from '@/components/Brand';
import { EditorWorkspace } from '@/components/editor/EditorWorkspace';
import { ApiError, GUEST_COOKIE, SHARE_COOKIE, apiFetch } from '@/lib/api';

export const metadata = { title: 'Shared document' };

function Unavailable({ message }: { message: string }) {
  return (
    <div className="share-join-page">
      <header className="share-header">
        <a href="/">
          <Brand />
        </a>
      </header>
      <main className="share-join">
        <p className="eyebrow">Share link</p>
        <h1>This link is not available.</h1>
        <p className="share-lede">{message}</p>
        <a className="btn btn-primary" href="/">
          Go to CoEdit
        </a>
      </main>
    </div>
  );
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  let context: ShareContextDto;
  try {
    const data = await apiFetch<{ share: ShareContextDto }>(
      `/shares/${encodeURIComponent(token)}/context`,
      {},
      { auth: 'none' },
    );
    context = data.share;
  } catch (caught) {
    if (caught instanceof ApiError) {
      return (
        <Unavailable
          message={
            caught.status === 410
              ? 'The owner let this link expire or revoked it. Ask for a fresh one.'
              : 'We could not find a share link with that token.'
          }
        />
      );
    }
    return <Unavailable message="The collaboration server is not reachable right now." />;
  }

  const jar = await cookies();
  const shareCookie = jar.get(SHARE_COOKIE)?.value;
  const guestName = jar.get(GUEST_COOKIE)?.value;

  if (!guestName || shareCookie !== token) {
    return (
      <div className="share-join-page">
        <header className="share-header">
          <a href="/">
            <Brand />
          </a>
          <span className="share-header-note">No account needed</span>
        </header>

        <main className="share-join">
          <div className="share-join-card">
            <span className={`badge badge-${context.role}`}>{context.role}</span>
            <p className="eyebrow">Shared by {context.ownerName}</p>
            <h1>{context.title}</h1>
            <p className="share-lede">{ROLE_DESCRIPTIONS[context.role]}</p>

            {error ? <p className="form-error">{error}</p> : null}

            <form action="/api/share-session" method="post" className="share-form-inline">
              <input type="hidden" name="token" value={token} />
              <label className="field">
                <span>Your name</span>
                <input
                  className="input"
                  type="text"
                  name="name"
                  placeholder="How should we label your cursor?"
                  maxLength={40}
                  autoComplete="name"
                  required
                  autoFocus
                />
              </label>
              <button className="btn btn-primary btn-lg" type="submit">
                Join the document
              </button>
            </form>

            <p className="hint">
              You will join as a <strong>{context.role}</strong>
              {context.expiresAt
                ? ` · link expires ${new Date(context.expiresAt).toLocaleDateString()}`
                : ' · link does not expire'}
            </p>
          </div>

          <ul className="share-points">
            <li>Your display name appears next to your cursor</li>
            <li>No account, no email, no download</li>
            <li>Permissions are enforced by the sync server</li>
          </ul>
        </main>
      </div>
    );
  }

  let documentInfo: DocumentDetailDto;
  try {
    const data = await apiFetch<{ document: DocumentDetailDto }>(
      `/documents/${encodeURIComponent(context.documentId)}`,
      {},
      { auth: 'share' },
    );
    documentInfo = { ...data.document, role: context.role };
  } catch {
    return <Unavailable message="This share link expired or was revoked while you were away." />;
  }

  const wsUrl =
    process.env.WS_URL ?? process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8787/ws';

  return (
    <EditorWorkspace
      documentInfo={documentInfo}
      mode="share"
      viewerName={guestName}
      viewerColor={pickPresenceColor(`${token}:${guestName}`)}
      guestName={guestName}
      userId={null}
      wsUrl={wsUrl}
    />
  );
}
