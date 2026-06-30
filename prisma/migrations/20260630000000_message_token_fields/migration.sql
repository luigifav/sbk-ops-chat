ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "inputTokens"         INTEGER,
  ADD COLUMN IF NOT EXISTS "outputTokens"        INTEGER,
  ADD COLUMN IF NOT EXISTS "cacheReadTokens"     INTEGER,
  ADD COLUMN IF NOT EXISTS "cacheCreationTokens" INTEGER;
