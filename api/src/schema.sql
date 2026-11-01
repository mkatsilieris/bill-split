-- Idempotent schema. Executed on every API start.

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
