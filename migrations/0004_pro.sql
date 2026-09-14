-- Pro (paywall experiment). See docs/PRO_PLAN.md — the contract between the
-- Worker side and the page side; change it before changing either.
CREATE TABLE IF NOT EXISTS pro_licences (
  licence_hash TEXT PRIMARY KEY,
  stripe_customer TEXT NOT NULL,
  stripe_subscription TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,               -- 'year' | 'month'
  status TEXT NOT NULL,             -- 'active' | 'past_due' | 'cancelled'
  current_period_end INTEGER,       -- unix seconds from Stripe
  email TEXT,                       -- from Checkout, for manual key recovery only
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS pro_events (
  event_id TEXT PRIMARY KEY,        -- Stripe event id, idempotency
  received_at INTEGER NOT NULL
);
