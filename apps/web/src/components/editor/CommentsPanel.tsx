'use client';

import { useState } from 'react';
import type { CommentDto } from '@coedit/shared';
import { formatRelative, initials } from '@/lib/format';
import type { TextSelection } from './MarkdownEditor';

interface CommentsPanelProps {
  comments: CommentDto[];
  canComment: boolean;
  selected: TextSelection;
  onJump: (quote: string) => void;
  onCreate: (input: {
    body: string;
    anchorQuote: string | null;
    anchorFrom: number | null;
    anchorTo: number | null;
  }) => Promise<void>;
  onResolve: (comment: CommentDto, resolved: boolean) => Promise<void>;
  onDelete: (comment: CommentDto) => Promise<void>;
  currentUserId: string | null;
  canModerate: boolean;
}

export function CommentsPanel({
  comments,
  canComment,
  selected,
  onJump,
  onCreate,
  onResolve,
  onDelete,
  currentUserId,
  canModerate,
}: CommentsPanelProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quote = selected.text.trim().slice(0, 400);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        body: body.trim(),
        anchorQuote: quote || null,
        anchorFrom: quote ? selected.from : null,
        anchorTo: quote ? selected.to : null,
      });
      setBody('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not post the comment');
    } finally {
      setBusy(false);
    }
  };

  const open = comments.filter((comment) => !comment.resolved);
  const resolved = comments.filter((comment) => comment.resolved);

  return (
    <div className="panel-stack">
      {canComment ? (
        <form className="comment-composer" onSubmit={submit}>
          {quote ? (
            <div className="quote-chip">
              <span>{quote}</span>
            </div>
          ) : (
            <p className="hint">Select text in the document to anchor your comment.</p>
          )}
          <textarea
            className="textarea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Leave a note for the author…"
            rows={3}
            maxLength={4000}
          />
          {error ? <p className="form-error">{error}</p> : null}
          <div className="composer-actions">
            <span className="hint">{body.length}/4000</span>
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
              {busy ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </form>
      ) : (
        <p className="panel-note">This link is read-only. Comments are disabled for viewers.</p>
      )}

      <div className="comment-list">
        {open.length === 0 && resolved.length === 0 ? (
          <p className="panel-note">No comments yet. Start a conversation on the draft.</p>
        ) : null}

        {open.map((comment) => (
          <article className="comment-card" key={comment.id}>
            <header>
              <span className="avatar avatar-sm" style={{ backgroundColor: '#c8c0ad' }}>
                {initials(comment.authorName)}
              </span>
              <div>
                <strong>{comment.authorName}</strong>
                <span className="comment-meta">
                  {comment.isGuest ? 'guest · ' : ''}
                  {formatRelative(comment.createdAt)}
                </span>
              </div>
              {canComment ? (
                <button
                  type="button"
                  className="icon-btn"
                  title="Resolve comment"
                  onClick={() => void onResolve(comment, true)}
                >
                  ✓
                </button>
              ) : null}
            </header>
            {comment.anchorQuote ? (
              <button
                type="button"
                className="anchored-quote"
                onClick={() => onJump(comment.anchorQuote!)}
                title="Jump to the quoted text"
              >
                “{comment.anchorQuote}”
              </button>
            ) : null}
            <p>{comment.body}</p>
            {(canModerate || (currentUserId && comment.authorId === currentUserId)) ? (
              <button
                type="button"
                className="text-btn"
                onClick={() => void onDelete(comment)}
              >
                Delete
              </button>
            ) : null}
          </article>
        ))}

        {resolved.length > 0 ? (
          <div className="resolved-group">
            <p className="section-caption">Resolved</p>
            {resolved.map((comment) => (
              <article className="comment-card comment-resolved" key={comment.id}>
                <header>
                  <span className="avatar avatar-sm" style={{ backgroundColor: '#c8c0ad' }}>
                    {initials(comment.authorName)}
                  </span>
                  <div>
                    <strong>{comment.authorName}</strong>
                    <span className="comment-meta">{formatRelative(comment.createdAt)}</span>
                  </div>
                  {canComment ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Reopen comment"
                      onClick={() => void onResolve(comment, false)}
                    >
                      ↺
                    </button>
                  ) : null}
                </header>
                <p>{comment.body}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
