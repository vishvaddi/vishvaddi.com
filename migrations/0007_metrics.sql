-- Funnel counters (POST /api/metric, worker/pro.ts). One row per (day, event);
-- day is UTC "YYYY-MM-DD". See docs/PRO_PLAN.md Addendum 3.
CREATE TABLE IF NOT EXISTS metrics (day TEXT NOT NULL, event TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, event));
