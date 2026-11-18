'use client';

import { useEffect, useState } from 'react';
import { ROLE_DESCRIPTIONS, SHARE_ROLES, type CreatedShareLinkDto, type ShareLinkDto, type ShareRole } from '@coedit/shared';
import { formatDateTime, formatRelative } from '@/lib/format';

interface SharePanelProps {
  shares: ShareLinkDto[];
  canManage: boolean;
  onCreate: (input: {
    role: ShareRole;
    label: string;
    expiresInDays: number | null;
  }) => Promise<CreatedShareLinkDto>;
  onRevoke: (share: ShareLinkDto) => Promise<void>;
}

export function SharePanel({ shares, canManage, onCreate, onRevoke }: SharePanelProps) {
  const [role, setRole] = useState<ShareRole>('viewer');
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedShareLinkDto | null>(null);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const share = await onCreate({
        role,
        label: label.trim(),
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      });
      setCreated(share);
      setLabel('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the link');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!created) return;
    const url = `${origin}/s/${created.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard unavailable — select the link and copy it manually.');
    }
  };

  if (!canManage) {
    return (
      <p className="panel-note">
        Share links can be created from the owner&apos;s account. Guests with editor links can
        edit, but cannot invite more people.
      </p>
    );
  }

  return (
    <div className="panel-stack">
      <form className="share-form" onSubmit={create}>
        <label className="field">
          <span>Permission</span>
          <select
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value as ShareRole)}
          >
            {SHARE_ROLES.map((value) => (
              <option key={value} value={value}>
                {value[0]!.toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{ROLE_DESCRIPTIONS[role]}</p>
        <div className="field-row">
          <label className="field">
            <span>Label</span>
            <input
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Design review"
              maxLength={100}
            />
          </label>
          <label className="field">
            <span>Expires</span>
            <select
              className="select"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            >
              <option value="1">In 1 day</option>
              <option value="7">In 7 days</option>
              <option value="30">In 30 days</option>
              <option value="never">Never</option>
            </select>
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Creating…' : 'Create share link'}
        </button>
      </form>

      {created ? (
        <div className="created-link">
          <div>
            <p className="eyebrow">New {created.role} link</p>
            <code>{`${origin}/s/${created.token}`}</code>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}

      <div className="share-list">
        <p className="section-caption">Active and past links</p>
        {shares.length === 0 ? (
          <p className="panel-note">No links yet. A viewer link is the safest default.</p>
        ) : null}
        {shares.map((share) => {
          const expired = share.expiresAt ? new Date(share.expiresAt).getTime() <= Date.now() : false;
          const state = share.revokedAt ? 'revoked' : expired ? 'expired' : 'active';
          return (
            <article className="share-row" key={share.id}>
              <div className="share-row-head">
                <span className={`badge badge-${share.role}`}>{share.role}</span>
                <span className={`link-state link-${state}`}>{state}</span>
              </div>
              <div className="share-row-body">
                <strong>{share.label || 'Untitled link'}</strong>
                <code>…{share.tokenHint}</code>
              </div>
              <div className="share-row-meta">
                <span>
                  {share.expiresAt ? `expires ${formatDateTime(share.expiresAt)}` : 'no expiry'}
                </span>
                <span>{share.lastUsedAt ? `used ${formatRelative(share.lastUsedAt)}` : 'unused'}</span>
              </div>
              {state === 'active' ? (
                <button
                  type="button"
                  className="text-btn danger"
                  onClick={() => void onRevoke(share)}
                >
                  Revoke
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
