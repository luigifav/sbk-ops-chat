-- Índice vetorial de DocumentChunk: IVFFlat com lists = 100 -> HNSW.
--
-- Por que o IVFFlat tinha recall baixo (issue #61): ele foi criado com
-- lists = 100, uma ordem de magnitude acima do recomendado para um corpus desta
-- ordem (a recomendação do pgvector é linhas / 1000 até 1M de linhas), então as
-- listas ficaram quase vazias. Somado a isso, nada no projeto executa
-- `SET ivfflat.probes`, e o padrão do pgvector é probes = 1: cada consulta
-- sondava 1 lista de 100, ou seja examinava algo perto de 1% do corpus. Como o
-- Prisma abre conexões novas, não havia como o valor ser diferente de 1. O
-- vizinho mais próximo real ficava fora da lista sondada com frequência alta, e
-- cada busca que voltava vazia caía no fallback, que troca alguns milhares de
-- tokens de trechos ranqueados por até 80.000 caracteres de dump de documentos.
--
-- HNSW dá recall alto em corpus pequeno e médio sem depender de tuning de
-- probes. Os parâmetros são os defaults do pgvector (m = 16,
-- ef_construction = 64), adequados para as 1024 dimensões do voyage-3.
--
-- A consulta sobe `hnsw.ef_search` de 40 para 120 via `SET LOCAL` na própria
-- transação (ver RAG_EF_SEARCH em app/api/chat/route.ts). O motivo é que
-- ef_search é o teto de candidatos que a varredura devolve ANTES do JOIN, ou
-- seja antes do filtro de cliente: com 40, a consulta que pede 30 candidatos
-- trazia 21,7 em média, porque o filtro descartava parte dos 40. O índice não
-- guarda esse valor, ele é por sessão, então não há nada a configurar aqui.
--
-- Recall@6 medido em corpus sintético de 2.400 chunks (1024 dims, chunks
-- agrupados em clusters, filtro de cliente de produção, 200 queries), contra a
-- verdade exata de uma varredura sequencial:
--
--   ivfflat lists=100 probes=1  (o que existia)  ->  40,3%   top-6 exato em   2/200
--   hnsw m=16 ef_search=40                       ->  99,9%   top-6 exato em 199/200
--   hnsw m=16 ef_search=120                      -> 100,0%   top-6 exato em 200/200
--
-- O ganho vem quase todo da troca de índice, não do over-fetch: com o ivfflat,
-- pedir 30 candidatos em vez de 6 mantinha o recall em 40,3%, porque o problema
-- era a lista sondada, não o tamanho do LIMIT.
--
-- RESSALVA que vale para quem for medir o efeito em produção: nesse mesmo corpus
-- de 2.400 chunks, com o planner livre, o Postgres preferiu varredura sequencial
-- a qualquer um dos dois índices. Isso não é defeito: a sequencial é exata, dá
-- recall de 100% e nessa escala é barata. Duas consequências práticas: (1) se o
-- corpus de produção for dessa ordem, o índice pode nem estar sendo usado, e
-- então ele não é a causa da taxa de fallback observada, que é exatamente o que o
-- passo de medir antes existia para descobrir; (2) o valor desta migração é
-- garantir que, quando o corpus crescer e o índice passar a ser escolhido, ele
-- não derrube o recall de 100% para 40%. Confirmar com EXPLAIN ANALYZE na base
-- real qual dos dois caminhos o planner escolhe.
--
-- A criação do HNSW é mais lenta que a do IVFFlat e toma ACCESS EXCLUSIVE sobre
-- DocumentChunk enquanto roda, bloqueando leitura e escrita da tabela. Em corpus
-- pequeno são segundos; ainda assim, aplicar fora do horário de pico. Não dá
-- para usar CONCURRENTLY aqui porque o Prisma roda cada migração dentro de uma
-- transação, e CREATE INDEX CONCURRENTLY não pode rodar em transação.
DROP INDEX IF EXISTS documentchunk_embedding_idx;

CREATE INDEX IF NOT EXISTS documentchunk_embedding_hnsw_idx
  ON "DocumentChunk"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Índice de apoio em Document(active, category).
--
-- Nota honesta sobre o alcance dele: na consulta de RAG o filtro por cliente é
-- avaliado depois da varredura do índice vetorial, e o acesso a Document é feito
-- por chave primária (dc."documentId"), então este índice não é o que sustenta
-- aquele filtro. O que compensa o descarte pós-índice é a consulta pedir mais
-- candidatos do que usa. Ele existe porque o mesmo par de colunas é o filtro das
-- três leituras de Document que toda requisição de chat faz por fora do RAG:
-- instruções fixas, instruções do cliente efetivo e o dump do fallback, todas em
-- `where: { active: true, category: ... }`.
CREATE INDEX IF NOT EXISTS "Document_active_category_idx"
  ON "Document" ("active", "category");
