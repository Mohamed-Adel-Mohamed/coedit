import { redirect } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { hasAccountCookie } from '@/lib/api';

export const metadata = { title: 'Create account' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await hasAccountCookie()) redirect('/documents');
  const { error } = await searchParams;

  return (
    <div className="auth-page">
      <section className="auth-aside">
        <a href="/" className="auth-brand">
          <Brand />
        </a>
        <div>
          <p className="eyebrow">Start a workspace</p>
          <h2>
            Your next draft
            <br />
            has company.
          </h2>
          <p>
            Create a document, drop a link in chat, and watch the cursor of the person
            you are writing with move through the paragraph.
          </p>
        </div>
        <ul className="auth-points">
          <li>No setup, no websocket configuration</li>
          <li>Markdown with a live split preview</li>
          <li>Comments anchored to the text</li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <a href="/" className="auth-mini-brand">
            <Brand compact />
          </a>
          <h1>Create an account</h1>
          <p className="auth-sub">You can invite the rest of the team with a link later.</p>

          {error ? <p className="form-error">{error}</p> : null}

          <form action="/api/auth/register" method="post" className="auth-form">
            <label className="field">
              <span>Display name</span>
              <input
                className="input"
                type="text"
                name="displayName"
                autoComplete="name"
                placeholder="Ada Lovelace"
                maxLength={60}
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={10}
                placeholder="At least 10 characters"
                required
              />
            </label>
            <button className="btn btn-primary btn-lg" type="submit">
              Create workspace
            </button>
          </form>

          <p className="auth-switch">
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </div>
      </section>
    </div>
  );
}
