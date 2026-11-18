'use client';

import { Brand } from '@/components/Brand';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="share-join-page">
      <header className="share-header">
        <a href="/">
          <Brand />
        </a>
      </header>
      <main className="share-join">
        <p className="eyebrow">Something broke</p>
        <h1>The page failed to render.</h1>
        <p className="share-lede">
          {error.message || 'An unexpected error occurred.'} You can retry, or head back to
          the workspace.
        </p>
        <div className="cta-row">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <a className="btn btn-outline" href="/documents">
            Workspace
          </a>
        </div>
      </main>
    </div>
  );
}
