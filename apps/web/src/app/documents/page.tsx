import { redirect } from 'next/navigation';
import type { DocumentSummaryDto, UserDto } from '@coedit/shared';
import { Brand } from '@/components/Brand';
import { DeleteDocumentButton } from '@/components/DeleteDocumentButton';
import { ApiError, apiFetch, getCurrentUser } from '@/lib/api';
import { formatRelative, initials } from '@/lib/format';

export const metadata = { title: 'Workspace' };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { error } = await searchParams;

  let documents: DocumentSummaryDto[] = [];
  let loadError: string | null = null;
  try {
    const data = await apiFetch<{ documents: DocumentSummaryDto[] }>(
      '/documents',
      {},
      { auth: 'account' },
    );
    documents = data.documents;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) redirect('/login');
    loadError = caught instanceof Error ? caught.message : 'Could not load your documents';
  }

  return (
    <div className="app-page">
      <header className="app-topbar">
        <a href="/" className="app-brand">
          <Brand compact />
        </a>
        <span className="app-topbar-sep">/</span>
        <span className="app-topbar-label">Workspace</span>
        <div className="app-topbar-actions">
          <span className="user-chip">
            <span className="avatar avatar-sm" style={{ backgroundColor: user.color }}>
              {initials(user.displayName)}
            </span>
            <span>{user.displayName}</span>
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="app-main">
        <div className="workspace-head">
          <div>
            <p className="eyebrow">Documents</p>
            <h1>Your workspace</h1>
            <p className="workspace-sub">
              {documents.length} {documents.length === 1 ? 'document' : 'documents'} · edited
              together, saved continuously
            </p>
          </div>
          <form action="/api/documents/create" method="post" className="new-doc-form">
            <input
              className="input"
              name="title"
              placeholder="Name a new document…"
              maxLength={140}
              aria-label="New document title"
            />
            <button className="btn btn-primary" type="submit">
              New document
            </button>
          </form>
        </div>

        {error || loadError ? (
          <p className="form-error banner-error">{error ?? loadError}</p>
        ) : null}

        {documents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">#</div>
            <h2>Nothing here yet.</h2>
            <p>Start a document, then share the link. The first sentence is the hardest.</p>
          </div>
        ) : (
          <div className="doc-grid">
            {documents.map((document) => (
              <article className="doc-card" key={document.id}>
                <a href={`/documents/${document.id}`} className="doc-card-link">
                  <div className="doc-card-top">
                    <span className="doc-glyph" aria-hidden="true">
                      #
                    </span>
                    <span className={`badge badge-${document.role}`}>Owner</span>
                  </div>
                  <h2>{document.title}</h2>
                  <p className="doc-card-meta">
                    {document.commentCount}{' '}
                    {document.commentCount === 1 ? 'comment' : 'comments'} ·{' '}
                    {document.snapshotCount}{' '}
                    {document.snapshotCount === 1 ? 'version' : 'versions'}
                  </p>
                  <footer className="doc-card-footer">
                    <span>edited {formatRelative(document.updatedAt)}</span>
                    <span className="arrow" aria-hidden="true">
                      ↗
                    </span>
                  </footer>
                </a>
                <DeleteDocumentButton id={document.id} title={document.title} />
              </article>
            ))}
          </div>
        )}

        <section className="workspace-tip">
          <div>
            <p className="eyebrow">Try the multiplayer part</p>
            <h2>Open the same document in two windows.</h2>
            <p>
              Create a share link from the editor, open it in a private window, and watch
              presence and cursors move between the two sessions.
            </p>
          </div>
          <div className="tip-steps">
            <span>1. Open a document</span>
            <span>2. Share → viewer link</span>
            <span>3. Paste it in another tab</span>
          </div>
        </section>
      </main>
    </div>
  );
}
