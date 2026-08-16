CREATE TABLE IF NOT EXISTS deep_swarm_accounts (
  account_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  save_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS deep_swarm_accounts_updated_at
  ON deep_swarm_accounts(updated_at);
