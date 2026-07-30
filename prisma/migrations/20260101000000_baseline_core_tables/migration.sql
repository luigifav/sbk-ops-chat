-- Baseline das três tabelas centrais: Operator, Message e Setting.
--
-- Por que esta migração existe, e por que o timestamp é anterior a todas as
-- outras: o banco de produção foi criado com `prisma db push` (é o que o README
-- instrui), e o diretório de migrações só começou a existir em abril de 2026,
-- com a tabela Document. O resultado é que Operator, Message e Setting nunca
-- tiveram migração nenhuma: existiam apenas no `schema.prisma` e no banco que o
-- `db push` moldou. O diretório de migrações, portanto, não era capaz de
-- reconstruir o schema. Rodar `prisma migrate reset` ou apontar o
-- `DATABASE_URL` para um banco novo produzia um banco com Document e
-- DocumentChunk e sem nenhuma das três, e nesse estado `prisma.operator
-- .findFirst()` levanta P2021 e o login devolve 500 para todo mundo. O login é
-- o ponto onde isso deixa de ter contorno.
--
-- O timestamp precisa ordenar antes de 20260630000000_message_token_fields e
-- companhia porque aquelas migrações fazem `ALTER TABLE "Message" ADD COLUMN IF
-- NOT EXISTS`, e o IF NOT EXISTS ali se aplica à coluna, não à tabela: num banco
-- vazio elas falham se Message ainda não existir. `prisma migrate deploy` aplica
-- o que não está registrado em `_prisma_migrations`, na ordem lexicográfica dos
-- diretórios, e não reclama de uma migração pendente que ordene antes de outras
-- já aplicadas.
--
-- Em qualquer banco que já esteja de pé, incluindo produção, esta migração é um
-- no-op: todo comando é IF NOT EXISTS. Ela só tem efeito num banco que não tem
-- as tabelas, que é exatamente o caso que ela existe para consertar.
--
-- As definições abaixo refletem o estado atual do `schema.prisma`, com todas as
-- colunas que as migrações posteriores adicionam a Message. Isso é deliberado:
-- num banco novo esta migração cria a tabela completa e as posteriores viram
-- no-op pelo próprio IF NOT EXISTS delas. Ao alterar `schema.prisma`, o lugar de
-- registrar a mudança continua sendo uma migração nova, não este arquivo, que
-- não pode ser editado depois de aplicado (o Prisma guarda o checksum).

CREATE TABLE IF NOT EXISTS "Operator" (
  "id"        TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "password"  TEXT         NOT NULL,
  "active"    BOOLEAN      NOT NULL DEFAULT true,
  "status"    TEXT         NOT NULL DEFAULT 'active',
  "clients"   TEXT[]       NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Message" (
  "id"                    TEXT         NOT NULL,
  "question"              TEXT         NOT NULL,
  "answer"                TEXT         NOT NULL,
  "sessionId"             TEXT         NOT NULL,
  "responseTimeMs"        INTEGER      NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operatorName"          TEXT         NOT NULL DEFAULT 'Anônimo',
  "theme"                 TEXT,
  "inputTokens"           INTEGER,
  "outputTokens"          INTEGER,
  "cacheReadTokens"       INTEGER,
  "cacheCreationTokens"   INTEGER,
  "cacheCreation1hTokens" INTEGER,
  "detectedClient"        TEXT,
  "feedback"              INTEGER,
  "ragFallback"           BOOLEAN      NOT NULL DEFAULT false,
  "ragTopScore"           DOUBLE PRECISION,
  "model"                 TEXT,
  "stopReason"            TEXT,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Setting" (
  "key"   TEXT NOT NULL,
  "value" TEXT NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);
