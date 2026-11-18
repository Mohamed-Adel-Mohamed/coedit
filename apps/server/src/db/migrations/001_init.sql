CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled document',
  last_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_owner_updated_idx
  ON documents (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token_hint text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
  label text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_links_document_idx
  ON share_links (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS doc_updates (
  id bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  update bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, seq)
);

CREATE INDEX IF NOT EXISTS doc_updates_document_seq_idx
  ON doc_updates (document_id, seq);

CREATE TABLE IF NOT EXISTS snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  state bytea NOT NULL,
  content text NOT NULL,
  label text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('auto', 'manual', 'pre-restore')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snapshots_document_created_idx
  ON snapshots (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  is_guest boolean NOT NULL DEFAULT false,
  body text NOT NULL,
  anchor_quote text,
  anchor_from integer,
  anchor_to integer,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_document_created_idx
  ON comments (document_id, created_at ASC);
