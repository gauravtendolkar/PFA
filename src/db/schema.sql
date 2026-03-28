-- PFA Schema v1

CREATE TABLE IF NOT EXISTS plaid_items (
  id              TEXT PRIMARY KEY,
  plaid_id        TEXT NOT NULL UNIQUE,
  access_token    TEXT NOT NULL,
  institution_id  TEXT,
  institution_name TEXT,
  sync_cursor     TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  error_code      TEXT,
  last_synced_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  plaid_item_id   TEXT REFERENCES plaid_items(id),
  plaid_account_id TEXT UNIQUE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  subtype         TEXT,
  classification  TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  current_balance INTEGER NOT NULL DEFAULT 0,
  available_balance INTEGER,
  institution_name TEXT,
  mask            TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_classification ON accounts(classification);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  plaid_id        TEXT UNIQUE,
  amount          INTEGER NOT NULL,
  date            TEXT NOT NULL,
  name            TEXT NOT NULL,
  merchant_name   TEXT,
  category_id     TEXT REFERENCES categories(id),
  plaid_category  TEXT,
  direction       TEXT NOT NULL,
  pending         INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  tags            TEXT,
  payment_channel TEXT,
  source          TEXT NOT NULL DEFAULT 'plaid',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_txn_account_date ON transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_direction ON transactions(direction);
CREATE INDEX IF NOT EXISTS idx_txn_direction_date ON transactions(direction, date);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant_name);

CREATE TABLE IF NOT EXISTS categories (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  parent_id       TEXT REFERENCES categories(id),
  classification  TEXT NOT NULL,
  color           TEXT,
  icon            TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Daily balance per account (one row per account per day, recorded at sync time)
CREATE TABLE IF NOT EXISTS balance_history (
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  date            TEXT NOT NULL,
  balance         INTEGER NOT NULL,     -- cents
  PRIMARY KEY (account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_balance_history_date ON balance_history(date);

-- Daily aggregate networth snapshot (one row per day)
CREATE TABLE IF NOT EXISTS networth_snapshots (
  date            TEXT PRIMARY KEY,     -- YYYY-MM-DD
  networth        INTEGER NOT NULL,     -- cents (assets - liabilities)
  total_assets    INTEGER NOT NULL,
  total_liabilities INTEGER NOT NULL,
  breakdown       TEXT,                  -- JSON: [{ account_id, name, type, balance }]
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Current holdings (replaced on each sync, not historical)
CREATE TABLE IF NOT EXISTS holdings (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  security_id     TEXT NOT NULL REFERENCES securities(id),
  quantity        REAL NOT NULL,
  cost_basis      INTEGER,              -- cents
  value           INTEGER NOT NULL,     -- cents
  price           INTEGER NOT NULL,     -- cents per unit
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);

CREATE TABLE IF NOT EXISTS securities (
  id              TEXT PRIMARY KEY,
  plaid_security_id TEXT UNIQUE,
  ticker          TEXT,
  name            TEXT NOT NULL,
  type            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insights (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium',
  related_account_id TEXT REFERENCES accounts(id),
  expires_at      TEXT,
  is_dismissed    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insights_active ON insights(is_dismissed, expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  source          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  role            TEXT NOT NULL,
  content         TEXT,
  tool_calls      TEXT,
  tool_call_id    TEXT,
  tool_name       TEXT,
  is_error        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS schema_version (
  version         INTEGER NOT NULL,
  applied_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
