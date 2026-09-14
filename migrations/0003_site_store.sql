-- Cross-device sync for the personal tools (/kitchen, /money, /training …).
-- One JSON document per tool key; revision guards against two devices writing
-- over each other. The Worker's PIN gate is the only auth — the site is private.
CREATE TABLE IF NOT EXISTS site_store (
  key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
