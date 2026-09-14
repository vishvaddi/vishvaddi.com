-- Free-use quota (paywall addendum, docs/PRO_PLAN.md). One row per bucket —
-- `anon:<id>` (signed __Host-anon cookie) and `ip:<hash>` (CF-Connecting-IP) —
-- both counted, stricter wins. A bucket resets when window_start is more than
-- 30 days old.
CREATE TABLE IF NOT EXISTS free_uses (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL);
