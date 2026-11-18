import * as Y from 'yjs';
import { pickPresenceColor } from '@coedit/shared';
import { createPool } from '../db.js';
import { runMigrations } from '../db/migrate.js';
import { hashPassword } from '../auth/password.js';
import { hashShareToken } from '../auth/tokens.js';
import { createUser, findUserByEmail } from '../repositories/users.js';
import { logger } from '../logger.js';

const DEMO_PASSWORD = 'Password123!';

function encodeState(content: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText('content').insert(0, content);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

const launchOld = [
  '# Northstar launch brief',
  '',
  '**Owner:** Ada Lovelace · **Draft 1**',
  '',
  'We are planning a public beta for Northstar. The goal is to learn how teams',
  'collaborate on documents before we commit to a pricing model.',
  '',
  '## What ships',
  '',
  '- A collaborative editor',
  '- Share links',
  '- Version history',
].join('\n');

const launchCurrent = [
  '# Northstar launch brief',
  '',
  '**Owner:** Ada Lovelace · **Target:** 14 March · **Status:** Locked',
  '',
  '> The beta is a learning instrument, not a revenue event. Every decision below',
  '> is judged against one question: does it help us watch real teams write together?',
  '',
  '## TL;DR',
  '',
  'Ship a focused multiplayer markdown workspace to 40 design partners. Measure',
  'time-to-first-sentence with another person, session length, and week-two return.',
  'Hold pricing, integrations, and the public template gallery until we have signal.',
  '',
  '## Goals',
  '',
  '- [x] Conflict-free editing with live cursors',
  '- [x] Role-based share links: viewer, commenter, editor',
  '- [x] Restorable version history',
  '- [ ] Presence that survives a server restart',
  '- [ ] A five-minute onboarding path with no empty-document dead end',
  '',
  '## What ships',
  '',
  '| Surface | Detail | Owner |',
  '| --- | --- | --- |',
  '| Editor | Markdown, split preview, CRDT sync | Ada |',
  '| Sharing | Expiring links, three roles | Sam |',
  '| History | Automatic + manual snapshots | Ada |',
  '| Comments | Anchored to selected text | Sam |',
  '',
  '## The sync contract',
  '',
  'Every keystroke becomes a Yjs update. Updates are applied locally first, then',
  'fanned out over the socket and appended to the durable log. The database is the',
  'recovery path — never the hot path.',
  '',
  '```ts',
  "doc.on('update', (update, origin) => {",
  '  broadcast(update);',
  "  if (origin !== 'redis') persist(update);",
  '});',
  '```',
  '',
  '## Non-goals for beta',
  '',
  '1. Real-time audio or video',
  '2. A public template marketplace',
  '3. Offline-first conflict resolution beyond the local CRDT cache',
  '4. Enterprise SSO (design partner feedback first)',
  '',
  '## Risks',
  '',
  '- **Cold start.** An empty doc with nobody else in it feels like a demo, not a tool.',
  '  Mitigation: seed every new workspace with a short guided doc.',
  '- **Permission confusion.** A commenter who can edit is a support ticket. The server,',
  '  not the UI, enforces the role.',
  '- **Snapshot sprawl.** Autosave needs a cadence tied to activity, not a timer alone.',
  '',
  '## Open questions',
  '',
  '- Do teams want comments anchored to a paragraph or to an exact character range?',
  '- What is the right default share role — viewer or commenter?',
  '- Should restoring a version notify everyone in the document? (Yes, with a banner.)',
  '',
  '---',
  '',
  '_Last edited by Ada and Sam in the same document, at the same time._',
].join('\n');

const rfcContent = [
  '# RFC 004 — CRDT sync over WebSockets',
  '',
  '**Status:** Accepted · **Author:** Sam Rivera · **Reviewers:** Ada, Priya',
  '',
  '## Context',
  '',
  'We need several people to edit one markdown document without a merge button.',
  'Operational transforms require a central ordering authority and get subtle at the',
  'edges. CRDTs converge without asking permission, which matches our failure model:',
  'the socket will drop, the tab will sleep, the server will deploy mid-sentence.',
  '',
  '## Decision',
  '',
  'Use **Yjs** as the document model and `y-protocols` for sync and awareness.',
  '',
  '- The client owns its local edits; the server merges and fans out.',
  '- Persist the append-only update log plus periodic full-state snapshots.',
  '- Presence and cursors travel on the awareness channel and are never persisted.',
  '',
  '## Protocol',
  '',
  'A binary frame starts with a message type:',
  '',
  '| Byte | Meaning |',
  '| --- | --- |',
  '| `0` | CRDT sync (step 1, step 2, update) |',
  '| `1` | Awareness (presence, cursor, selection) |',
  '',
  'Text frames are reserved for JSON control messages: `ready`, `error`,',
  '`comments-changed`, `snapshots-changed`, `title-changed`.',
  '',
  '## Authorization',
  '',
  'A socket is admitted with a **short-lived, single-use ticket** minted by the REST',
  'API for exactly one document and role. The ticket is a signed JWT with a `jti`',
  'that is consumed on first use (Redis when available, process memory otherwise).',
  'Viewers and commenters still receive sync steps and presence, but the server',
  'drops any document update they send.',
  '',
  '## Persistence',
  '',
  'Updates are appended in arrival order with a per-document sequence. A snapshot',
  'captures the encoded state and the plain markdown at that moment. Loading is:',
  '',
  '```',
  'latest snapshot + every update after it (Yjs updates are idempotent)',
  '```',
  '',
  'The log is append-only. Compaction is an explicit maintenance job because deleting',
  'updates across multiple server instances requires a proven state-vector watermark.',
  '',
  '## Failure modes',
  '',
  '- **Socket loss:** reconnect requests a fresh ticket, then a sync step 1 exchange',
  '  closes the gap. No data is lost because the local CRDT still holds unacked edits.',
  '- **Instance loss:** another instance loads snapshot + log. Updates from the lost',
  '  instance may be up to one flush window behind.',
  '- **Restore:** the live document is rewritten as a normal transaction, so it merges',
  '  like any other edit instead of replacing client state out from under them.',
  '',
  '## Open questions',
  '',
  '- Do we need per-user undo across reconnects? (Yjs UndoManager is per session.)',
  '- At what log size does a snapshot-first load become noticeably slow?',
].join('\n');

const notesContent = [
  '# Field notes — design partner interviews',
  '',
  '**Week 6 · 9 conversations**',
  '',
  '## Pattern 1 — people share a link before they share a login',
  '',
  'Every team described the same first move: paste a link into chat. Nobody wants to',
  'provision accounts for a document that might be read once.',
  '',
  '> "If I have to add them as a user before they can read the draft, I just export a PDF."',
  '> — Ops lead, 12-person studio',
  '',
  '## Pattern 2 — commenting is the real permission boundary',
  '',
  'The useful cut is not read/write. It is **can this person change the text** versus',
  '**can this person tell me what to change**. Two teams asked for exactly that split.',
  '',
  '## Pattern 3 — version history is a trust feature',
  '',
  'Nobody asked for branching. Three people asked, unprompted, for a way to undo',
  'someone else\'s afternoon.',
  '',
  '## Follow-ups',
  '',
  '- [ ] Test a viewer link as the default share action',
  '- [ ] Prototype inline comments anchored to a quote',
  '- [ ] Ask about audit needs before promising history retention',
].join('\n');

async function main(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);

  const existing = await findUserByEmail(pool, 'demo@coedit.dev');
  if (existing) {
    logger.info('Demo data already present — run `npm run db:reset && npm run seed` for a clean slate');
    await pool.end();
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ada = await createUser(pool, {
    email: 'demo@coedit.dev',
    passwordHash,
    displayName: 'Ada Lovelace',
    color: pickPresenceColor('demo@coedit.dev'),
  });
  const sam = await createUser(pool, {
    email: 'sam@coedit.dev',
    passwordHash,
    displayName: 'Sam Rivera',
    color: pickPresenceColor('sam@coedit.dev'),
  });

  const launch = await pool.query<{ id: string }>(
    `INSERT INTO documents (owner_id, title, created_at, updated_at)
     VALUES ($1, $2, now() - interval '6 days', now() - interval '4 minutes') RETURNING id`,
    [ada.id, 'Northstar launch brief'],
  );
  const launchId = launch.rows[0]!.id;

  const rfc = await pool.query<{ id: string }>(
    `INSERT INTO documents (owner_id, title, created_at, updated_at)
     VALUES ($1, $2, now() - interval '3 days', now() - interval '2 hours') RETURNING id`,
    [sam.id, 'RFC 004 — CRDT sync over WebSockets'],
  );
  const rfcId = rfc.rows[0]!.id;

  const notes = await pool.query<{ id: string }>(
    `INSERT INTO documents (owner_id, title, created_at, updated_at)
     VALUES ($1, $2, now() - interval '1 day', now() - interval '1 day') RETURNING id`,
    [ada.id, 'Field notes — user interviews'],
  );
  const notesId = notes.rows[0]!.id;

  await pool.query(
    `INSERT INTO snapshots (document_id, seq, state, content, label, kind, created_by, created_at)
     VALUES ($1, 0, $2, $3, $4, 'auto', $5, now() - interval '5 days')`,
    [launchId, Buffer.from(encodeState(launchOld)), launchOld, 'First draft', ada.id],
  );
  await pool.query(
    `INSERT INTO snapshots (document_id, seq, state, content, label, kind, created_by, created_at)
     VALUES ($1, 0, $2, $3, $4, 'manual', $5, now() - interval '10 minutes')`,
    [launchId, Buffer.from(encodeState(launchCurrent)), launchCurrent, 'Beta scope locked', ada.id],
  );

  await pool.query(
    `INSERT INTO snapshots (document_id, seq, state, content, label, kind, created_by)
     VALUES ($1, 0, $2, $3, 'RFC accepted', 'manual', $4)`,
    [rfcId, Buffer.from(encodeState(rfcContent)), rfcContent, sam.id],
  );

  await pool.query(
    `INSERT INTO snapshots (document_id, seq, state, content, label, kind, created_by)
     VALUES ($1, 0, $2, $3, 'Interview synthesis', 'auto', $4)`,
    [notesId, Buffer.from(encodeState(notesContent)), notesContent, ada.id],
  );

  await pool.query(
    `INSERT INTO comments (document_id, author_id, author_name, is_guest, body, anchor_quote)
     VALUES
       ($1, $2, 'Ada Lovelace', false, $3, $4),
       ($1, $2, 'Ada Lovelace', false, $5, $6),
       ($1, NULL, 'Priya (design)', true, $7, $8)`,
    [
      launchId,
      sam.id,
      'Worth calling out the restart gap on the beta page — it is the honest version.',
      'Presence that survives a server restart',
      'Can we make viewer the default share role for this doc? Commenter might be better.',
      'What is the right default share role — viewer or commenter?',
      'The table sells the scope. I would move it above the goals section.',
      '| Surface | Detail | Owner |',
    ],
  );

  const shareTokens = {
    viewer: 'demoViewerLink4f8a2c6e9b1d3f5a7c9e2b4d6f8a1c3e',
    commenter: 'demoCommenterLink7b2d4f6a8c1e3b5d7f9a2c4e6b8d1f3a',
    editor: 'demoEditorLink9d1f3b5a7c2e4f6b8d1a3c5e7f9b2d4a',
  } as const;

  for (const [role, token] of Object.entries(shareTokens)) {
    await pool.query(
      `INSERT INTO share_links (document_id, token_hash, token_hint, role, label, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        launchId,
        hashShareToken(token),
        token.slice(-6),
        role,
        `Demo ${role} link`,
        ada.id,
      ],
    );
  }

  await pool.end();

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  CoEdit demo data seeded',
      '',
      '  Accounts',
      `    demo@coedit.dev / ${DEMO_PASSWORD}   (Ada Lovelace)`,
      `    sam@coedit.dev  / ${DEMO_PASSWORD}   (Sam Rivera)`,
      '',
      '  Documents',
      '    Northstar launch brief          — owned by Ada, 2 versions, 3 comments',
      '    RFC 004 — CRDT sync over WebSockets — owned by Sam',
      '    Field notes — user interviews   — owned by Ada',
      '',
      '  Share links (Northstar launch brief)',
      `    viewer     ${webOrigin}/s/${shareTokens.viewer}`,
      `    commenter  ${webOrigin}/s/${shareTokens.commenter}`,
      `    editor     ${webOrigin}/s/${shareTokens.editor}`,
      '',
    ].join('\n'),
  );
}

main().catch(async (error: unknown) => {
  logger.error({ err: error }, 'seed failed');
  process.exitCode = 1;
});
