import { Brand } from '@/components/Brand';

export default function NotFound() {
  return (
    <div className="share-join-page">
      <header className="share-header">
        <a href="/">
          <Brand />
        </a>
      </header>
      <main className="share-join">
        <p className="eyebrow">404</p>
        <h1>That page is blank.</h1>
        <p className="share-lede">
          The document may have been deleted, or the link was mistyped. Blank pages are
          only useful inside the editor.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="/documents">
            Your workspace
          </a>
          <a className="btn btn-outline" href="/">
            Home
          </a>
        </div>
      </main>
    </div>
  );
}
