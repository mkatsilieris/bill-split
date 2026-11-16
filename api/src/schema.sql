-- Idempotent schema. Executed on every API start.

-- Search that ignores case, accents (Σούπερ = σουπερ = ΣΟΥΠΕΡ) and the final sigma.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION search_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT translate(lower(unaccent('unaccent', $1)), 'ς', 'σ') $$;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token      TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  -- how expenses are split by default inside this group
  split_mode  TEXT NOT NULL DEFAULT 'equal' CHECK (split_mode IN ('equal', 'percentage')),
  invite_code TEXT UNIQUE NOT NULL,
  created_by  INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id      INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  -- used when groups.split_mode = 'percentage'; all members of a group should sum to 100
  share_percent NUMERIC(6, 2),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  group_id    INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by     INT NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category    TEXT,
  spent_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 'group' = followed the group default at creation time; otherwise a custom split
  split_type  TEXT NOT NULL DEFAULT 'group' CHECK (split_type IN ('group', 'equal', 'percentage', 'exact')),
  created_by  INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_group_idx ON expenses(group_id, spent_at DESC);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id),
  amount     NUMERIC(12, 2) NOT NULL,
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id         SERIAL PRIMARY KEY,
  group_id   INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user  INT NOT NULL REFERENCES users(id),
  to_user    INT NOT NULL REFERENCES users(id),
  amount     NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  note       TEXT,
  settled_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlements_group_idx ON settlements(group_id, settled_at DESC);

-- One row per bulk import (e.g. a Splitwise export). The imported expenses / settlements point back
-- to it through import_id, so a whole import can be reviewed or undone (soft-deleted) at once.
CREATE TABLE IF NOT EXISTS imports (
  id          SERIAL PRIMARY KEY,
  group_id    INT NOT NULL REFERENCES groups(id),
  source      TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  summary     JSONB,
  created_by  INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  INT REFERENCES users(id)
);
-- the same file is imported into a group only once (unless that import was undone)
CREATE UNIQUE INDEX IF NOT EXISTS imports_file_idx ON imports(group_id, file_sha256) WHERE deleted_at IS NULL;
ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS import_id INT REFERENCES imports(id);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS import_id INT REFERENCES imports(id);

-- Changes of who owes whom that are neither an expense nor money changing hands: a correction
-- ('adjustment'), or a debt moved to another group ('transfer_out' here and 'transfer_in' in the
-- other group, the two rows pointing at each other through counterpart_id).
-- Effect on balances: direction 'increase' = debtor owes creditor `amount` more, 'decrease' = less.
CREATE TABLE IF NOT EXISTS debt_changes (
  id             SERIAL PRIMARY KEY,
  group_id       INT NOT NULL REFERENCES groups(id),
  debtor         INT NOT NULL REFERENCES users(id),
  creditor       INT NOT NULL REFERENCES users(id),
  amount         NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  direction      TEXT NOT NULL CHECK (direction IN ('increase', 'decrease')),
  kind           TEXT NOT NULL CHECK (kind IN ('adjustment', 'transfer_out', 'transfer_in')),
  counterpart_id INT REFERENCES debt_changes(id),
  note           TEXT,
  changed_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     INT NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  deleted_by     INT REFERENCES users(id),
  CHECK (debtor <> creditor)
);
CREATE INDEX IF NOT EXISTS debt_changes_group_idx ON debt_changes(group_id, changed_at DESC);

-- Values the API creates itself on first start and keeps (e.g. the Web Push VAPID key pair).
CREATE TABLE IF NOT EXISTS app_secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per browser / phone that accepted push notifications. Turned off (by the person, by
-- logging out, or because the push service says the subscription expired) = deleted_at set.
-- The same device subscribing again brings its row back.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id),
  endpoint     TEXT UNIQUE NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  deleted_by   INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id) WHERE deleted_at IS NULL;

-- Personal access tokens (Profile > Claude): let a program act as the person without their password.
-- Only the SHA-256 of the token is kept; "hint" is its first characters, to recognise it in a list.
-- A token belongs to one person and reaches only what that person reaches. Revoked = deleted_at set.
-- (No keep_history trigger: last_used_at changes all the time and the hash has no place in row_history.)
CREATE TABLE IF NOT EXISTS api_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  token_hash   TEXT UNIQUE NOT NULL,
  hint         TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  deleted_by   INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id) WHERE deleted_at IS NULL;

-- The categories a group offers in its expense form. Every group starts with default_categories()
-- and its members add, rename and remove their own. expenses.category keeps the name as text:
-- renaming a category here renames it in the expenses of the group too (routes/categories.ts),
-- removing one leaves the expenses as they are. Names are unique per group ignoring case and accents.
CREATE OR REPLACE FUNCTION default_categories() RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT ARRAY['Σούπερ μάρκετ', 'Φαγητό', 'Λογαριασμοί', 'Ενοίκιο', 'Μεταφορικά', 'Διαμονή', 'Διασκέδαση', 'Υγεία', 'Παιδιά', 'Άλλο'] $$;

CREATE TABLE IF NOT EXISTS group_categories (
  id         SERIAL PRIMARY KEY,
  group_id   INT NOT NULL REFERENCES groups(id),
  name       TEXT NOT NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by INT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS group_categories_name_idx ON group_categories(group_id, search_norm(name)) WHERE deleted_at IS NULL;

-- Groups from before this table (no rows at all, not even removed ones) get the defaults plus
-- whatever other categories their expenses already use.
WITH fresh AS (
  SELECT g.id FROM groups g WHERE NOT EXISTS (SELECT 1 FROM group_categories c WHERE c.group_id = g.id)
), names AS (
  SELECT f.id AS group_id, d.name, d.pos
    FROM fresh f CROSS JOIN unnest(default_categories()) WITH ORDINALITY AS d(name, pos)
  UNION ALL
  SELECT e.group_id, min(btrim(e.category)), 1000
    FROM expenses e JOIN fresh f ON f.id = e.group_id
   WHERE btrim(e.category) <> ''
     AND search_norm(btrim(e.category)) NOT IN (SELECT search_norm(x) FROM unnest(default_categories()) AS x)
   GROUP BY e.group_id, search_norm(btrim(e.category))
)
INSERT INTO group_categories (group_id, name)
SELECT group_id, name FROM names ORDER BY group_id, pos, name;

-- Nothing is ever removed: rows are flagged with deleted_at and can be restored.
ALTER TABLE groups        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES users(id);
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES users(id);
ALTER TABLE expenses      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES users(id);
ALTER TABLE settlements   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES users(id);

-- Previous version of every changed row, so that edits can be undone too.
-- Rows changed in one transaction share the same changed_at.
CREATE TABLE IF NOT EXISTS row_history (
  id         BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation  TEXT NOT NULL,
  old_row    JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS row_history_table_idx ON row_history(table_name, changed_at DESC);

CREATE OR REPLACE FUNCTION keep_row_history() RETURNS trigger AS $$
BEGIN
  INSERT INTO row_history (table_name, operation, old_row)
  VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(OLD) - 'password_hash');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forbid_hard_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows of % are never deleted, set deleted_at instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'groups', 'group_members', 'expenses', 'expense_shares', 'settlements', 'imports', 'debt_changes', 'app_secrets', 'push_subscriptions', 'group_categories'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER keep_history AFTER UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION keep_row_history()', t);
  END LOOP;
  -- expense_shares is left out: editing an expense replaces its shares, the old ones stay in row_history
  FOREACH t IN ARRAY ARRAY['users', 'groups', 'group_members', 'expenses', 'settlements', 'imports', 'debt_changes', 'app_secrets', 'push_subscriptions', 'group_categories', 'api_tokens', 'row_history'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER forbid_delete BEFORE DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION forbid_hard_delete()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['users', 'groups', 'group_members', 'expenses', 'expense_shares', 'settlements', 'imports', 'debt_changes', 'app_secrets', 'push_subscriptions', 'group_categories', 'api_tokens', 'row_history'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER forbid_truncate BEFORE TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION forbid_hard_delete()', t);
  END LOOP;
END;
$$;
