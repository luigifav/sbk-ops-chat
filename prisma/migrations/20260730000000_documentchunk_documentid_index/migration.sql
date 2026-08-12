-- Índice de DocumentChunk("documentId"), declarado como `@@index([documentId])`
-- no schema.prisma desde que o modelo existe, mas que nenhuma migração criava.
--
-- A migração 20260410000001_add_pgvector_chunks cria a tabela com a foreign key
-- para Document, e o Postgres não cria índice para o lado que referencia, só para
-- a chave referenciada. Num banco moldado por `prisma db push` o índice existe,
-- porque o push materializa o `@@index` do schema. Num banco reconstruído pelo
-- diretório de migrações, não existia: `prisma migrate diff` contra um banco
-- recém-migrado acusava exatamente esta diferença.
--
-- Sem ele, o `ON DELETE CASCADE` de cada Document apagado varre DocumentChunk
-- inteira, e o mesmo vale para qualquer leitura de chunks por documento.
--
-- IF NOT EXISTS porque em produção o índice já deve estar lá, criado pelo push.
CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_idx"
  ON "DocumentChunk" ("documentId");
