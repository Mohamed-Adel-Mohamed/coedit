'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { EditorView } from '@codemirror/view';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ROLE_LABELS,
  canComment as roleCanComment,
  canEdit as roleCanEdit,
  canManageShares,
  type CommentDto,
  type CreatedShareLinkDto,
  type DocumentDetailDto,
  type ShareLinkDto,
  type ShareRole,
  type SnapshotDetailDto,
  type SnapshotSummaryDto,
} from '@coedit/shared';
import { Brand } from '@/components/Brand';
import { MarkdownEditor, type TextSelection } from './MarkdownEditor';
import { PresenceBar } from './PresenceBar';
import { CommentsPanel } from './CommentsPanel';
import { VersionsPanel } from './VersionsPanel';
import { SharePanel } from './SharePanel';
import { CollabSocket, type ConnectionStatus } from '@/lib/collab-socket';
import { clientApi, fetchWsTicket, type EditorMode } from '@/lib/client-api';
import { formatRelative, readingTime, wordCount } from '@/lib/format';

interface EditorWorkspaceProps {
  documentInfo: DocumentDetailDto;
  mode: EditorMode;
  viewerName: string;
  viewerColor: string;
  guestName?: string | null;
  userId: string | null;
  wsUrl: string;
}

type SideTab = 'comments' | 'versions' | 'share';
type ViewMode = 'write' | 'split' | 'preview';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Live',
  offline: 'Reconnecting',
  error: 'Connection issue',
  stopped: 'Closed',
};

export function EditorWorkspace({
  documentInfo,
  mode,
  viewerName,
  viewerColor,
  guestName,
  userId,
  wsUrl,
}: EditorWorkspaceProps) {
  const [doc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(doc));
  const ytext = useMemo(() => doc.getText('content'), [doc]);

  const [text, setText] = useState('');
  const [title, setTitle] = useState(documentInfo.title);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [ticketRole, setTicketRole] = useState(documentInfo.role);
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotSummaryDto[]>([]);
  const [shares, setShares] = useState<ShareLinkDto[]>([]);
  const [sideTab, setSideTab] = useState<SideTab>('comments');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [selection, setSelection] = useState<TextSelection>({ from: 0, to: 0, text: '' });
  const [toast, setToast] = useState<string | null>(null);
  const [titleBusy, setTitleBusy] = useState(false);
  const viewRef = useRef<EditorView | null>(null);

  const role = ticketRole;
  const canEdit = roleCanEdit(role);
  const canComment = roleCanComment(role);
  const canManage = mode === 'account' && canManageShares(role);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const update = (): void => setText(ytext.toString());
    update();
    doc.on('update', update);
    return () => {
      doc.off('update', update);
    };
  }, [doc, ytext]);

  const loadComments = useCallback(async () => {
    try {
      const data = await clientApi<{ comments: CommentDto[] }>(
        `/documents/${documentInfo.id}/comments`,
        {},
        mode,
      );
      setComments(data.comments);
    } catch {
      /* a failed refresh should not interrupt editing */
    }
  }, [documentInfo.id, mode]);

  const loadSnapshots = useCallback(async () => {
    try {
      const data = await clientApi<{ snapshots: SnapshotSummaryDto[] }>(
        `/documents/${documentInfo.id}/snapshots`,
        {},
        mode,
      );
      setSnapshots(data.snapshots);
    } catch {
      /* ignore refresh failures */
    }
  }, [documentInfo.id, mode]);

  const loadShares = useCallback(async () => {
    if (!canManage) return;
    try {
      const data = await clientApi<{ shares: ShareLinkDto[] }>(
        `/documents/${documentInfo.id}/shares`,
        {},
        mode,
      );
      setShares(data.shares);
    } catch {
      /* ignore refresh failures */
    }
  }, [documentInfo.id, mode, canManage]);

  useEffect(() => {
    void loadComments();
    void loadSnapshots();
    void loadShares();
  }, [loadComments, loadSnapshots, loadShares]);

  useEffect(() => {
    const socket = new CollabSocket({
      doc,
      awareness,
      wsUrl,
      identity: { name: viewerName, color: viewerColor },
      getTicket: () => fetchWsTicket(documentInfo.id, mode, guestName),
      onStatus: (nextStatus, detail) => {
        setStatus(nextStatus);
        setStatusDetail(detail ?? null);
      },
      onTicket: (ticket) => setTicketRole(ticket.role),
      onControl: (message) => {
        if (message.type === 'comments-changed') void loadComments();
        else if (message.type === 'snapshots-changed') void loadSnapshots();
        else if (message.type === 'title-changed') setTitle(message.title);
        else if (message.type === 'error') {
          showToast(message.message);
          if (message.code === 'read-only') setTicketRole(documentInfo.role);
        } else if (message.type === 'ready') {
          setTicketRole(message.role);
        }
      },
    });
    socket.connect();
    return () => socket.destroy();
  }, [
    doc,
    awareness,
    wsUrl,
    viewerName,
    viewerColor,
    documentInfo.id,
    documentInfo.role,
    mode,
    guestName,
    loadComments,
    loadSnapshots,
    showToast,
  ]);

  const commitTitle = async (): Promise<void> => {
    const next = title.trim();
    if (!next) {
      setTitle(documentInfo.title);
      return;
    }
    if (next === documentInfo.title) return;
    setTitleBusy(true);
    try {
      const data = await clientApi<{ document: DocumentDetailDto }>(
        `/documents/${documentInfo.id}`,
        { method: 'PATCH', body: JSON.stringify({ title: next }) },
        mode,
      );
      setTitle(data.document.title);
    } catch (error) {
      setTitle(documentInfo.title);
      showToast(error instanceof Error ? error.message : 'Could not rename the document');
    } finally {
      setTitleBusy(false);
    }
  };

  const createComment = async (input: {
    body: string;
    anchorQuote: string | null;
    anchorFrom: number | null;
    anchorTo: number | null;
  }): Promise<void> => {
    await clientApi(
      `/documents/${documentInfo.id}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          guestName: mode === 'share' ? guestName ?? viewerName : undefined,
        }),
      },
      mode,
    );
    await loadComments();
  };

  const resolveComment = async (comment: CommentDto, resolved: boolean): Promise<void> => {
    try {
      await clientApi(
        `/comments/${comment.id}`,
        { method: 'PATCH', body: JSON.stringify({ resolved }) },
        mode,
      );
      await loadComments();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the comment');
    }
  };

  const deleteComment = async (comment: CommentDto): Promise<void> => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await clientApi(`/comments/${comment.id}`, { method: 'DELETE' }, mode);
      await loadComments();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete the comment');
    }
  };

  const createSnapshot = async (label: string): Promise<void> => {
    await clientApi(
      `/documents/${documentInfo.id}/snapshots`,
      { method: 'POST', body: JSON.stringify({ label }) },
      mode,
    );
    await loadSnapshots();
    showToast('Version saved');
  };

  const previewSnapshot = async (
    snapshot: SnapshotSummaryDto,
  ): Promise<SnapshotDetailDto> => {
    const data = await clientApi<{ snapshot: SnapshotDetailDto }>(
      `/documents/${documentInfo.id}/snapshots/${snapshot.id}`,
      {},
      mode,
    );
    return data.snapshot;
  };

  const restoreSnapshot = async (snapshot: SnapshotSummaryDto): Promise<void> => {
    await clientApi(
      `/documents/${documentInfo.id}/snapshots/${snapshot.id}/restore`,
      { method: 'POST' },
      mode,
    );
    await loadSnapshots();
    showToast('Version restored for everyone');
  };

  const createShare = async (input: {
    role: ShareRole;
    label: string;
    expiresInDays: number | null;
  }): Promise<CreatedShareLinkDto> => {
    const data = await clientApi<{ share: CreatedShareLinkDto }>(
      `/documents/${documentInfo.id}/shares`,
      {
        method: 'POST',
        body: JSON.stringify({
          role: input.role,
          label: input.label,
          expiresInDays: input.expiresInDays ?? undefined,
        }),
      },
      mode,
    );
    await loadShares();
    return data.share;
  };

  const revokeShare = async (share: ShareLinkDto): Promise<void> => {
    try {
      await clientApi(
        `/documents/${documentInfo.id}/shares/${share.id}`,
        { method: 'DELETE' },
        mode,
      );
      await loadShares();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not revoke the link');
    }
  };

  const jumpToQuote = (quote: string): void => {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    const index = content.indexOf(quote);
    if (index === -1) {
      showToast('That text has changed since the comment was written.');
      return;
    }
    view.dispatch({
      selection: { anchor: index, head: index + quote.length },
      scrollIntoView: true,
    });
    view.focus();
  };

  const highlightRanges = useMemo(() => {
    const ranges: Array<{ from: number; to: number }> = [];
    for (const comment of comments) {
      if (!comment.anchorQuote) continue;
      const index = text.indexOf(comment.anchorQuote);
      if (index >= 0) ranges.push({ from: index, to: index + comment.anchorQuote.length });
    }
    return ranges;
  }, [comments, text]);

  const words = wordCount(text);
  const openComments = comments.filter((comment) => !comment.resolved).length;
  const statusLabel = STATUS_LABEL[status];

  return (
    <div className="workspace">
      <header className="ws-topbar">
        <div className="ws-brand">
          <a href={mode === 'account' ? '/documents' : '/'} className="ws-brand-link">
            <Brand compact />
          </a>
          <span className="ws-sep" aria-hidden="true">
            /
          </span>
          <a href={mode === 'account' ? '/documents' : '/'} className="ws-back">
            {mode === 'account' ? 'Workspace' : 'Shared'}
          </a>
        </div>

        <div className="ws-title-wrap">
          {canEdit ? (
            <input
              className="title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setTitle(documentInfo.title);
                  event.currentTarget.blur();
                }
              }}
              maxLength={140}
              aria-label="Document title"
              disabled={titleBusy}
            />
          ) : (
            <h1 className="title-static">{title}</h1>
          )}
          <p className="ws-subtitle">
            {documentInfo.ownerName}
            <span>·</span>
            {mode === 'share' ? `${ROLE_LABELS[role]} link` : ROLE_LABELS[role]}
            <span>·</span>
            edited {formatRelative(documentInfo.updatedAt)}
          </p>
        </div>

        <div className="ws-actions">
          <PresenceBar awareness={awareness} />
          <span className={`status status-${status}`} title={statusDetail ?? statusLabel}>
            <i aria-hidden="true" />
            {statusLabel}
          </span>
          <span className={`badge badge-${role}`}>{ROLE_LABELS[role]}</span>
          {mode === 'account' ? (
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="btn btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          ) : (
            <a href="/" className="btn btn-ghost btn-sm">
              Leave
            </a>
          )}
        </div>
      </header>

      {!canEdit ? (
        <div className="readonly-banner">
          <strong>{role === 'viewer' ? 'Viewing' : 'Commenting'}</strong>
          <span>
            {role === 'viewer'
              ? 'This link is read-only. You can watch changes live and follow cursors.'
              : 'You can select text and leave comments, but the document text is locked.'}
          </span>
        </div>
      ) : null}

      <div className="ws-main">
        <section className="ws-editor">
          <div className="pane-bar">
            <div className="segmented" role="tablist" aria-label="View mode">
              {(['write', 'split', 'preview'] as ViewMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === value}
                  className={viewMode === value ? 'is-active' : ''}
                  onClick={() => setViewMode(value)}
                >
                  {value[0]!.toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
            <div className="pane-stats">
              <span>{words} words</span>
              <span>{readingTime(words)}</span>
              <span className="mono">{documentInfo.id.slice(0, 8)}</span>
            </div>
          </div>

          <div className={`panes panes-${viewMode}`}>
            {viewMode !== 'preview' ? (
              <div className="editor-pane">
                <MarkdownEditor
                  ytext={ytext}
                  awareness={awareness}
                  canEdit={canEdit}
                  highlightRanges={highlightRanges}
                  onSelectionChange={setSelection}
                  onViewReady={(view) => {
                    viewRef.current = view;
                  }}
                />
              </div>
            ) : null}
            {viewMode !== 'write' ? (
              <div className="preview-pane">
                <article className="markdown-body">
                  {text.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                  ) : (
                    <p className="empty-preview">The document is empty. Start with a heading.</p>
                  )}
                </article>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="ws-side">
          <div className="side-tabs" role="tablist" aria-label="Document panels">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'comments'}
              className={sideTab === 'comments' ? 'is-active' : ''}
              onClick={() => setSideTab('comments')}
            >
              Comments
              {openComments > 0 ? <span className="count">{openComments}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'versions'}
              className={sideTab === 'versions' ? 'is-active' : ''}
              onClick={() => setSideTab('versions')}
            >
              Versions
              {snapshots.length > 0 ? <span className="count">{snapshots.length}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'share'}
              className={sideTab === 'share' ? 'is-active' : ''}
              onClick={() => setSideTab('share')}
            >
              Share
            </button>
          </div>

          <div className="side-scroll">
            {sideTab === 'comments' ? (
              <CommentsPanel
                comments={comments}
                canComment={canComment}
                selected={selection}
                onJump={jumpToQuote}
                onCreate={createComment}
                onResolve={resolveComment}
                onDelete={deleteComment}
                currentUserId={userId}
                canModerate={canEdit}
              />
            ) : null}
            {sideTab === 'versions' ? (
              <VersionsPanel
                snapshots={snapshots}
                canEdit={canEdit}
                onCreate={createSnapshot}
                onPreview={previewSnapshot}
                onRestore={restoreSnapshot}
              />
            ) : null}
            {sideTab === 'share' ? (
              <SharePanel
                shares={shares}
                canManage={canManage}
                onCreate={createShare}
                onRevoke={revokeShare}
              />
            ) : null}
          </div>
        </aside>
      </div>

      <footer className="ws-statusbar">
        <span className={`status status-${status}`}>
          <i aria-hidden="true" />
          {statusLabel}
        </span>
        <span>CRDT synced over WebSocket</span>
        <span>{openComments} open comments</span>
        <span className="grow" />
        <span>Snapshots in PostgreSQL</span>
        <span className="mono">v{snapshots.length}</span>
      </footer>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
