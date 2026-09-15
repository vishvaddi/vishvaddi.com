-- Money Pro waitlist (POST /api/waitlist, worker/waitlist.ts). Email is the
-- primary key so a repeat signup is a silent no-op rather than a duplicate row.
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
