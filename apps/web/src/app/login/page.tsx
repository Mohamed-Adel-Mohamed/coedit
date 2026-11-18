import { redirect } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { hasAccountCookie } from '@/lib/api';
import { DEMO_ACCOUNT } from '@/lib/demo';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
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
          <p className="eyebrow">Multiplayer markdown</p>
          <h2>
            The document is the
            <br />
            meeting.
          </h2>
          <p>
            No merge button, no &quot;who has the latest version&quot;. Just a shared
            surface where edits converge and everyone can see the sentence forming.
          </p>
        </div>
        <ul className="auth-points">
          <li>Live cursors and presence</li>
          <li>Viewer / commenter / editor links</li>
          <li>Version history with one-click restore</li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <a href="/" className="auth-mini-brand">
            <Brand compact />
          </a>
          <h1>Welcome back</h1>
          <p className="auth-sub">Sign in to your workspace. Demo credentials are pre-filled.</p>

          {error ? <p className="form-error">{error}</p> : null}

          <form action="/api/auth/login" method="post" className="auth-form">
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                name="email"
                autoComplete="email"
                defaultValue={DEMO_ACCOUNT.email}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                defaultValue={DEMO_ACCOUNT.password}
                minLength={1}
                required
              />
            </label>
            <button className="btn btn-primary btn-lg" type="submit">
              Sign in
            </button>
          </form>

          <p className="auth-switch">
            New here? <a href="/register">Create an account</a>
          </p>
          <div className="auth-demo">
            <strong>Demo workspace</strong>
            <span>
              {DEMO_ACCOUNT.email} · {DEMO_ACCOUNT.password}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
