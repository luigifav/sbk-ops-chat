CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "embeddingStatus" TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS "DocumentChunk" (
  "id"          TEXT        NOT NULL,
  "documentId"  TEXT        NOT NULL,
  "content"     TEXT        NOT NULL,
  "embedding"   vector(1024),
  "chunkIndex"  INTEGER     NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentChunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS documentchunk_embedding_idx
  ON "DocumentChunk"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
