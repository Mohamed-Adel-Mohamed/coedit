# CoEdit API

Base URL: `http://localhost:8787/api` (the web app proxies these as `/api/proxy/*`).

Two credentials are accepted:

- **Account:** `Authorization: Bearer <access token>`
- **Share link:** `X-Coedit-Share: <raw share token>` (scoped to one document)

Errors use a stable shape:

```json
{ "error": { "code": "forbidden", "message": "This link does not allow editing" } }
```

| Status | Meaning |
| --- | --- |
| 400 | Validation failure |
| 401 | Missing/invalid account credential |
| 403 | Authenticated but capability not granted |
| 404 | Document/link not found, or caller has no access |
| 409 | Email already registered |
| 410 | Share link expired or revoked |
| 429 | Rate limited |

## Auth

### `POST /auth/register`

```json
{ "email": "you@example.com", "password": "at-least-10-chars", "displayName": "Ada" }
```

`201` → `{ "token": "...", "user": { "id", "email", "displayName", "color", "createdAt" } }`

### `POST /auth/login`

```json
{ "email": "demo@coedit.dev", "password": "Password123!" }
```

`200` → same shape as register. `401` is intentionally generic.

### `GET /auth/me`

Requires an account token. Returns `{ "user": ... }`.

## Documents

### `GET /documents`

Account only. Returns documents owned by the caller, newest first:

```json
{ "documents": [ { "id", "title", "ownerId", "ownerName", "role": "owner",
  "commentCount", "snapshotCount", "createdAt", "updatedAt" } ] }
```

### `POST /documents`

```json
{ "title": "Optional title" }
```

`201` → `{ "document": DocumentDetail }`.

### `GET /documents/:id`

Account or share link. Returns `{ "document": DocumentDetail }` with the caller's resolved
role. A caller without access receives `404`, not `403`, so document existence is not
leaked.

### `PATCH /documents/:id`

Requires edit capability (owner or editor link).

```json
{ "title": "Renamed" }
```

Broadcasts `title-changed` to connected peers.

### `DELETE /documents/:id`

Owner only. Closes live sockets with code `4404` and cascades versions/comments/links.

## Share links

### `POST /documents/:id/shares`

Owner account only.

```json
{ "role": "viewer | commenter | editor", "label": "Design review", "expiresInDays": 7 }
```

`201` → `{ "share": { "id", "role", "label", "token": "<returned once>",
"tokenHint", "expiresAt", "createdAt", "revokedAt", "lastUsedAt" } }`

Tokens are never stored in plaintext, so they cannot be re-displayed after creation.

### `GET /documents/:id/shares`

Owner account. Returns link metadata without raw tokens.

### `DELETE /documents/:id/shares/:shareId`

Owner account. Revokes immediately for new tickets/API calls.

### `GET /shares/:token/context`

Public. `200` →

```json
{ "share": { "documentId", "title", "role", "expiresAt", "ownerName",
  "requiresGuestName": true } }
```

`410` when the link is expired or revoked.

## WebSocket ticket

### `POST /documents/:id/ws-ticket`

Account or share link. Optional body `{ "guestName": "Priya" }` (required in practice for
guests so their cursor has a label).

`200` →

```json
{ "ticket": "<signed JWT>", "wsPath": "/ws", "role": "editor",
  "expiresIn": 90, "canEdit": true, "canComment": true,
  "displayName": "Priya", "color": "#2dd4bf" }
```

Connect to `ws://localhost:8787/ws?ticket=...`. The ticket is single-use; a second attempt
closes with code `4401`. Origin must match `APP_ORIGINS`.

## Comments

### `GET /documents/:id/comments`

Read access (all roles). Open comments first, then resolved.

### `POST /documents/:id/comments`

Requires comment capability.

```json
{
  "body": "This needs a source.",
  "guestName": "Priya",
  "anchorQuote": "Presence that survives a restart",
  "anchorFrom": 120,
  "anchorTo": 158
}
```

`201` → `{ "comment": Comment }`. Broadcasts `comments-changed`.

### `PATCH /comments/:commentId`

```json
{ "resolved": true }
```

Requires comment capability on the parent document.

### `DELETE /comments/:commentId`

Allowed for the comment author or anyone with edit capability.

## Versions

### `GET /documents/:id/snapshots`

Read access. Returns metadata for up to 100 versions.

### `POST /documents/:id/snapshots`

Requires edit capability.

```json
{ "label": "Checkpoint before restructure" }
```

`201` → `{ "snapshot": SnapshotSummary }`. Creates a `manual` version from the live room.

### `GET /documents/:id/snapshots/:snapshotId`

Read access. Returns the summary plus full markdown `content`.

### `POST /documents/:id/snapshots/:snapshotId/restore`

Requires edit capability. Saves a `pre-restore` version, rewrites the live `Y.Text` inside
a transaction, and returns `{ "ok": true, "restoredFrom": "<id>" }`. Every connected peer
receives the resulting CRDT update.

## Operational

### `GET /health`

```json
{ "ok": true, "rooms": 1, "pubsub": "memory|redis",
  "tickets": "memory|redis", "uptimeSeconds": 42 }
```

### WebSocket close codes

| Code | Reason |
| --- | --- |
| 1001 | Room closed by the server |
| 1011 | Room failed to load |
| 4401 | Missing, invalid, expired, or already-used ticket |
| 4404 | Document deleted while connected |

Messages are documented in [ARCHITECTURE.md](ARCHITECTURE.md#wire-protocol).
