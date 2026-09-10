-- Monthly character spend for the ElevenLabs proxy (/api/tts). One row per
-- calendar month; the Worker refuses paid generations once the row passes
-- TTS_MONTHLY_CHARS and the pages fall back to the browser voice.
CREATE TABLE IF NOT EXISTS tts_usage (
  month TEXT PRIMARY KEY,
  chars INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
