'use client';

import { useState } from 'react';
import type { SnapshotDetailDto, SnapshotSummaryDto } from '@coedit/shared';
import { formatRelative } from '@/lib/format';

const KIND_LABEL: Record<SnapshotSummaryDto['kind'], string> = {
  auto: 'Autosave',
  manual: 'Manual',
  'pre-restore': 'Before restore',
};

interface VersionsPanelProps {
  snapshots: SnapshotSummaryDto[];
  canEdit: boolean;
  onCreate: (label: string) => Promise<void>;
  onPreview: (snapshot: SnapshotSummaryDto) => Promise<SnapshotDetailDto>;
  onRestore: (snapshot: SnapshotSummaryDto) => Promise<void>;
}

export function VersionsPanel({
  snapshots,
  canEdit,
  onCreate,
  onPreview,
  onRestore,
}: VersionsPanelProps) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ snapshot: SnapshotSummaryDto; content: string } | null>(
    null,
  );
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(label.trim());
      setLabel('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save a version');
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async (snapshot: SnapshotSummaryDto): Promise<void> => {
    setPreviewBusy(snapshot.id);
    setError(null);
    try {
      const detail = await onPreview(snapshot);
      setPreview({ snapshot, content: detail.content });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that version');
    } finally {
      setPreviewBusy(null);
    }
  };

  const restore = async (snapshot: SnapshotSummaryDto): Promise<void> => {
    const confirmed = window.confirm(
      `Restore "${snapshot.label || 'this version'}"? Everyone in the document will see the restored text, and the current state is saved first.`,
    );
    if (!confirmed) return;
    setError(null);
    try {
      await onRestore(snapshot);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not restore that version');
    }
  };

  return (
    <div className="panel-stack">
      {canEdit ? (
        <form className="version-create" onSubmit={create}>
          <input
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Name this checkpoint (optional)"
            maxLength={100}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save version'}
          </button>
        </form>
      ) : (
        <p className="panel-note">You can browse history. Restoring requires an editor link.</p>
      )}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="version-list">
        {snapshots.length === 0 ? (
          <p className="panel-note">No versions yet. Autosaves appear as the document changes.</p>
        ) : null}
        {snapshots.map((snapshot) => (
          <article className="version-row" key={snapshot.id}>
            <div className="version-head">
              <span className={`tag tag-${snapshot.kind}`}>{KIND_LABEL[snapshot.kind]}</span>
              <span className="version-time">{formatRelative(snapshot.createdAt)}</span>
            </div>
            <strong>{snapshot.label || 'Untitled version'}</strong>
            <div className="version-meta">
              <span>{snapshot.createdByName ?? 'System'}</span>
              <span>{(snapshot.sizeBytes / 1024).toFixed(1)} KB</span>
            </div>
            <div className="version-actions">
              <button
                type="button"
                className="text-btn"
                onClick={() => void openPreview(snapshot)}
                disabled={previewBusy === snapshot.id}
              >
                {previewBusy === snapshot.id ? 'Loading…' : 'Preview'}
              </button>
              {canEdit ? (
                <button type="button" className="text-btn" onClick={() => void restore(snapshot)}>
                  Restore
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {preview ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <header className="modal-head">
              <div>
                <p className="eyebrow">Version preview</p>
                <h3>{preview.snapshot.label || 'Untitled version'}</h3>
              </div>
              <button type="button" className="icon-btn" onClick={() => setPreview(null)}>
                ✕
              </button>
            </header>
            <pre className="version-preview">{preview.content || '(empty document)'}</pre>
            <footer className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>
                Close
              </button>
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void restore(preview.snapshot)}
                >
                  Restore this version
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
