import { Brand } from '@/components/Brand';
import { hasAccountCookie } from '@/lib/api';
import { DEMO_ACCOUNT, DEMO_SHARE_LINKS } from '@/lib/demo';

export default async function LandingPage() {
  const signedIn = await hasAccountCookie();

  return (
    <div className="landing">
      <header className="nav">
        <a href="/" className="nav-brand" aria-label="CoEdit home">
          <Brand />
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#roles">Roles</a>
          <a href="#stack">Stack</a>
          <a href="/s/demoViewerLink4f8a2c6e9b1d3f5a7c9e2b4d6f8a1c3e">Live demo</a>
        </nav>
        <div className="nav-actions">
          {signedIn ? (
            <a className="btn btn-primary" href="/documents">
              Open workspace
            </a>
          ) : (
            <>
              <a className="btn btn-ghost" href="/login">
                Sign in
              </a>
              <a className="btn btn-primary" href="/register">
                Start writing
              </a>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="pulse-dot" /> Real-time collaborative workspace
            </p>
            <h1>
              Write in the
              <br />
              <em>same breath.</em>
            </h1>
            <p className="hero-lede">
              CoEdit is a multiplayer markdown workspace where every keystroke merges
              itself. Live cursors, share links scoped to viewer, commenter or editor,
              and a version history you can actually restore.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary btn-lg" href={signedIn ? '/documents' : '/login'}>
                {signedIn ? 'Open your workspace' : 'Try the demo workspace'}
              </a>
              <a className="btn btn-outline btn-lg" href="#how">
                See the mechanics
              </a>
            </div>
            <ul className="hero-proof">
              <li>No merge button</li>
              <li>No account needed for guests</li>
              <li>Self-hostable</li>
            </ul>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="mock-window">
              <div className="mock-top">
                <span className="mock-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="mock-title">Northstar launch brief</span>
                <span className="mock-avatars">
                  <span style={{ background: '#f97316' }}>AL</span>
                  <span style={{ background: '#22d3ee' }}>SR</span>
                  <span className="mock-live">Live</span>
                </span>
              </div>
              <div className="mock-body">
                <div className="mock-gutter">
                  {Array.from({ length: 12 }, (_, index) => (
                    <span key={index}>{index + 1}</span>
                  ))}
                </div>
                <div className="mock-doc">
                  <span className="mock-h1">Northstar launch brief</span>
                  <span className="mock-muted">
                    The beta is a learning instrument, not a revenue event.
                  </span>
                  <span>&nbsp;</span>
                  <span>Ship a focused multiplayer markdown workspace</span>
                  <span>to 40 design partners. Measure time-to-first-sentence.</span>
                  <span>&nbsp;</span>
                  <span className="mock-quote">
                    Every keystroke becomes a Yjs update
                    <span className="mock-cursor" style={{ color: '#22d3ee' }}>
                      <span className="mock-caret" style={{ background: '#22d3ee' }} />
                      <span className="mock-name" style={{ background: '#22d3ee' }}>
                        Sam
                      </span>
                    </span>
                  </span>
                  <span>applied locally first, then fanned out.</span>
                  <span>&nbsp;</span>
                  <span className="mock-check">- [x] Conflict-free editing</span>
                  <span className="mock-check">- [x] Role-scoped share links</span>
                  <span className="mock-check">- [ ] Presence after restart</span>
                </div>
              </div>
              <div className="mock-status">
                <span className="status status-connected">
                  <i /> Live
                </span>
                <span>3 editing</span>
                <span className="grow" />
                <span>Saved to PostgreSQL</span>
              </div>
            </div>
            <div className="art-note art-note-left">
              <strong>viewer</strong> read-only link
            </div>
            <div className="art-note art-note-right">
              <strong>commenter</strong> can annotate
            </div>
          </div>
        </section>

        <section className="demo-strip">
          <div>
            <p className="eyebrow">Seeded demo</p>
            <p>
              Sign in as <code>{DEMO_ACCOUNT.email}</code> with{' '}
              <code>{DEMO_ACCOUNT.password}</code> — or open a share link with no account.
            </p>
          </div>
          <div className="demo-links">
            {DEMO_SHARE_LINKS.map((link) => (
              <a key={link.token} href={`/s/${link.token}`} className="demo-link">
                <span className={`badge badge-${link.role.toLowerCase()}`}>{link.role}</span>
                <span>{link.note}</span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-head">
            <p className="eyebrow">Mechanics</p>
            <h2>Built for the moment two people type at once.</h2>
            <p className="section-lede">
              The editor is the product, so the hard parts sit underneath it: convergence,
              authorization and recovery.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature">
              <span className="feature-index">01</span>
              <h3>Conflicts do not exist here</h3>
              <p>
                Yjs CRDTs merge concurrent keystrokes without a central lock. Close the
                laptop mid-sentence, reopen it, and your edits merge back with everyone
                else&apos;s.
              </p>
              <p className="feature-tag">Yjs · y-protocols · awareness</p>
            </article>
            <article className="feature">
              <span className="feature-index">02</span>
              <h3>Permission lives on the socket</h3>
              <p>
                A viewer can open the document, see every cursor and still never change a
                character. The server drops update frames from read-only roles — the UI is
                a convenience, not the boundary.
              </p>
              <p className="feature-tag">viewer · commenter · editor links</p>
            </article>
            <article className="feature">
              <span className="feature-index">03</span>
              <h3>History that survives the tab</h3>
              <p>
                Every session is backed by append-only updates and full-state snapshots.
                Restore a version and the change merges like any other edit, after saving
                the current state first.
              </p>
              <p className="feature-tag">PostgreSQL snapshots · reversible restore</p>
            </article>
          </div>
        </section>

        <section className="section roles-section" id="roles">
          <div className="section-head">
            <p className="eyebrow">Share by link</p>
            <h2>One document, three honest levels of trust.</h2>
          </div>
          <div className="role-grid">
            <article className="role-card">
              <span className="badge badge-viewer">Viewer</span>
              <h3>Read the room</h3>
              <p>Follow the draft and the cursors. Ideal for stakeholders and drive-by readers.</p>
              <ul>
                <li>Live document and presence</li>
                <li>Version history, read-only</li>
                <li>No edits, no comments</li>
              </ul>
            </article>
            <article className="role-card">
              <span className="badge badge-commenter">Commenter</span>
              <h3>Shape it without touching it</h3>
              <p>Select a sentence, leave a note, resolve the thread. Text stays locked.</p>
              <ul>
                <li>Everything a viewer can do</li>
                <li>Anchored comments</li>
                <li>No document updates accepted</li>
              </ul>
            </article>
            <article className="role-card role-card-accent">
              <span className="badge badge-editor">Editor</span>
              <h3>Write together</h3>
              <p>Full CRDT editing with cursors, checkpoints and version restore.</p>
              <ul>
                <li>Multiplayer editing</li>
                <li>Manual snapshots and restore</li>
                <li>Cannot invite more people</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="architecture" aria-label="Architecture">
          <div className="arch-copy">
            <p className="eyebrow">Under the hood</p>
            <h2>Next.js for the surface. A sync server for the truth.</h2>
            <p>
              The browser holds a Yjs replica and talks binary sync frames over a
              WebSocket. A short-lived, single-use ticket authorizes exactly one document
              and role. Updates land in an append-only log; snapshots make recovery cheap.
              Redis pub/sub fans presence across instances when you scale past one.
            </p>
            <ul className="arch-list">
              <li>
                <code>ws</code> sync + awareness protocol
              </li>
              <li>Ticket replay protection</li>
              <li>PostgreSQL snapshot + update log</li>
              <li>Redis fan-out with in-process fallback</li>
            </ul>
          </div>
          <div className="arch-diagram">
            <div className="arch-node">
              <span>Browser</span>
              <strong>CodeMirror 6 + Yjs</strong>
              <small>local replica · cursors</small>
            </div>
            <div className="arch-arrow">⇄ binary frames</div>
            <div className="arch-node arch-node-dark">
              <span>Realtime server</span>
              <strong>Node 22 + ws</strong>
              <small>sync · auth · snapshots</small>
            </div>
            <div className="arch-fan">
              <div className="arch-node arch-node-small">
                <span>PostgreSQL</span>
                <strong>documents · updates · snapshots</strong>
              </div>
              <div className="arch-node arch-node-small">
                <span>Redis</span>
                <strong>pub/sub · ticket replay guard</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="section stack-section" id="stack">
          <div className="section-head">
            <p className="eyebrow">Stack</p>
            <h2>Small, sharp, and self-hostable.</h2>
          </div>
          <ul className="chips">
            {[
              'TypeScript',
              'Next.js 16',
              'React 19',
              'Node.js 22',
              'Yjs CRDT',
              'WebSockets',
              'PostgreSQL',
              'Redis pub/sub',
              'Docker Compose',
            ].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="footer">
        <div>
          <Brand />
          <p>Collaborative markdown, with the hard parts included.</p>
        </div>
        <div className="footer-links">
          <a href="/login">Sign in</a>
          <a href="/register">Create account</a>
          <a href="/s/demoViewerLink4f8a2c6e9b1d3f5a7c9e2b4d6f8a1c3e">Viewer demo</a>
        </div>
      </footer>
    </div>
  );
}
