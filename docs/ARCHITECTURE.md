# Architecture

CoEdit is two processes over one PostgreSQL database:

1. **Web (`apps/web`)** — Next.js App Router. Renders the workspace, keeps the access
   token in an httpOnly cookie, and proxies browser calls to the API.
2. **Server (`apps/server`)** — Express REST API plus a `ws` gateway. It owns CRDT rooms,
   authorization, persistence, snapshots, and Redis fan-out.

Shared types, roles and protocol constants live in `packages/shared` so both processes
agree on capabilities and wire formats.

## Trust boundaries

```
browser ──cookie──► Next.js ──Bearer/share token──► API ──SQL──► PostgreSQL
   │                  │
   │   ticket         │
   └──WS──────────────┴──► gateway ── Room ── updates ──► PostgreSQL
                                └── awareness ──► Redis pub/sub ──► other instances
```

- The browser has **no long-lived API credential**. Access JWTs are httpOnly and only
  used server-to-server by the BFF.
- The WebSocket uses a **different, narrower credential**: a signed JWT with `doc`, `role`,
  `kind`, `name`, `color`, `jti` and a 90-second expiry. It is consumed on first use.
- Presence identity is **server-issued**. The room sanitizes every incoming awareness
  state by replacing `user` with the ticket identity while preserving cursor and
  selection fields.
- Read-only roles are not trusted to behave. The gateway drops sync step 2 / update
  frames from viewers and commenters and returns a `read-only` control message.

## Wire protocol

Binary frames start with a varuint message type.

| Type | Payload |
| --- | --- |
| `0` | `y-protocols/sync`: step 1, step 2, or update (encoded by `lib0`) |
| `1` | awareness update as a length-prefixed byte array |

Text frames are JSON control messages:

```ts
type ServerControl =
  | { type: 'ready'; version; documentId; role; canEdit; canComment; userId?;
      displayName; color }
  | { type: 'error'; code: 'read-only' | 'forbidden' | 'invalid-message' | 'server-error';
      message }
  | { type: 'comments-changed' }
  | { type: 'snapshots-changed' }
  | { type: 'title-changed'; title }
```

### Handshake

1. Gateway validates the ticket and consumes its `jti`.
2. Room loads snapshot + updates from PostgreSQL (idempotent Yjs replay).
3. `ready` control message is sent with the authoritative identity.
4. Server sends sync step 1; client replies with its state vector; server returns step 2.
5. Full awareness state is sent; the client's first awareness message triggers a presence
   replay so a cold room cannot lose the initial presence packet.

Frames that arrive while the ticket is being validated or the room is loading are
buffered, then replayed to the room. Without this, a cold room can swallow the client's
first sync step and leave it empty until the next edit.

### Updates and fan-out

A local edit is applied to the room's `Y.Doc` with the client object as transaction
origin. The `update` handler:

1. broadcasts the encoded update to local sockets (except the origin);
2. publishes `{origin: instanceId, kind: 'update', payload}` to
   `coedit:room:<documentId>`;
3. appends the update to `doc_updates` with the author and a per-document sequence.

A receiving instance applies the update with origin `'redis'`, relays it to its local
clients, and does **not** re-publish or re-persist it. Presence follows the same pattern;
control hints (comments/title/snapshots) are also published so REST-side changes reach
peers on every instance.

## Persistence

| Table | Purpose |
| --- | --- |
| `documents` | title, owner, `last_seq`, timestamps |
| `doc_updates` | append-only Yjs updates (`document_id`, `seq`, `author_id`, `update`) |
| `snapshots` | full encoded state + markdown content + label/kind/author |
| `share_links` | role, SHA-256 token hash, hint, expiry, revocation |
| `comments` | body, anchor quote, offsets, resolution, guest flag |
| `users` | email, scrypt hash, display name, presence colour |

**Loading:** latest snapshot + all updates, ordered by sequence. A snapshot may already
contain some of those updates; Yjs application is idempotent, so ordering across
instances is safe without a deletion watermark.

**Writing:** updates are queued per room through a promise chain, so sequence allocation
(`UPDATE documents SET last_seq = last_seq + 1 RETURNING last_seq`) and insert are
serialised for that room. Updates are durable before the next write in the chain.

**Auto snapshots:** after N updates or T milliseconds, and at room close when the content
differs from the last snapshot and the last snapshot is at least 10 seconds old. Duplicate
content is never snapshotted.

**Restore:** the target snapshot's markdown is written into the live `Y.Text` inside a
transaction (`delete` + `insert`), with a `pre-restore` snapshot taken first and the actor
recorded as the update author. Peers converge because this is just another CRDT update.

## Room lifecycle

- `RoomManager` deduplicates concurrent loads with a promise map.
- A room unloads 45 seconds after the last client leaves (configurable), flushing pending
  writes and taking a final snapshot.
- Room close unsubscribes from Redis, destroys awareness/doc timers, and clears sockets.
- Deleting a document shuts its room down with code `4404`.

## Scaling notes

- **Update persistence:** each update is written by the instance that received it.
  Sequence numbers are globally ordered by the database row lock. Snapshots are full
  state at the moment they are taken; because all updates are retained, a snapshot that
  missed an in-flight remote update cannot lose data on reload.
- **Presence:** awareness never persists; Redis pub/sub fans it across instances.
- **Ticket replay:** memory store is per process. Set `REDIS_URL` for `SET NX PX` across
  instances.
- **Snapshot sprawl:** auto-snapshot cadence and content dedupe are tuned for a demo.
  Production would add retention (keep manual + daily) and state-vector compaction.
- **Sticky routing:** not required for correctness, but a load balancer should use
  WebSocket-compatible connection draining on deploys.

## Why Yjs

A central OT server needs a total order and careful transformation rules. CoEdit's failure
model is a dropped socket and a sleeping laptop, not a LAN: CRDTs converge on reconnect
without asking the server for permission, and the state-vector exchange transfers only
what is missing. The cost is metadata growth, addressed by snapshotting and a future
compaction job.
