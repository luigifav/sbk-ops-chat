-- ============================================================================
-- DIAGNÓSTICO PÓS-DEPLOY das issues #61, #64 e #65
--
-- Cole INTEIRO no SQL editor do banco e rode. É seguro: só faz leitura, mais uma
-- função temporária de sessão que desaparece ao desconectar. Não altera dado.
--
-- ANTES DE RODAR, edite UMA linha: a data e hora do deploy, na seção 3.
--
-- Fonte da verdade do custo é `npm run measure`, que lê os preços de
-- lib/pricing.ts. A seção 3 aqui repete esses preços em SQL, porque um editor de
-- banco não importa TypeScript. Se lib/pricing.ts mudar, atualize a tabela
-- `precos` abaixo, senão os números desta seção mentem em silêncio.
-- ============================================================================


-- ============================================================================
-- SEÇÃO 1: o corpus e os índices
--
-- O tamanho do corpus decide se a migração da #61 pode fazer alguma coisa. Com
-- poucos milhares de chunks o Postgres tende a preferir varredura sequencial, que
-- é exata e nessa escala é barata. Isso não é defeito, mas significa que o índice
-- não era o gargalo.
-- ============================================================================
SELECT
  (SELECT count(*) FROM "DocumentChunk")                                   AS chunks,
  (SELECT count(*) FROM "DocumentChunk" WHERE embedding IS NOT NULL)       AS chunks_com_embedding,
  (SELECT count(*) FROM "Document" WHERE active)                           AS documentos_ativos,
  (SELECT count(DISTINCT category) FROM "Document" WHERE active)           AS categorias_ativas,
  CASE
    WHEN (SELECT count(*) FROM "DocumentChunk") < 3000
      THEN 'corpus pequeno: o planner provavelmente vai preferir varredura sequencial. Confira na seção 2.'
    ELSE 'corpus grande o suficiente para o índice valer. Confira na seção 2.'
  END AS leitura;

-- Os índices que a migração 20260729000003 deveria ter deixado.
SELECT
  indexname,
  CASE indexname
    WHEN 'documentchunk_embedding_hnsw_idx' THEN 'OK: índice novo, esperado'
    WHEN 'documentchunk_embedding_idx'      THEN 'PROBLEMA: índice ivfflat antigo ainda existe, a migração não rodou'
    ELSE 'outro'
  END AS situacao
FROM pg_indexes
WHERE tablename IN ('DocumentChunk', 'Document')
ORDER BY tablename, indexname;


-- ============================================================================
-- SEÇÃO 2: o índice está de fato sendo usado?
--
-- É o passo que mais pode mudar a conclusão sobre a #61.
--
-- Há uma pegadinha que esta função existe para evitar: o vetor da consulta
-- precisa ser um literal. Se você escrever o teste com subquery ou CTE, o planner
-- ignora o índice e você conclui "varredura sequencial" por artefato do teste, não
-- por decisão real. A função monta o SQL com o vetor interpolado como literal, do
-- mesmo jeito que o Prisma manda em produção.
--
-- Usa o embedding de um chunk existente como vetor de consulta: ele está na mesma
-- distribuição de uma pergunta real e evita ter que chamar a Voyage.
--
-- RODE ISTO PRIMEIRO, uma vez, logo após aplicar a migração:
--
--     ANALYZE "DocumentChunk";
--     ANALYZE "Document";
--
-- O índice HNSW acabou de ser criado e as estatísticas da tabela podem estar
-- velhas. A escolha entre índice e varredura sequencial é decisão de custo do
-- planner, e ele decide com base nessas estatísticas: sem ANALYZE, o veredicto
-- desta seção pode ser diferente do que vai valer meia hora depois, quando o
-- autovacuum passar. Não coloquei o ANALYZE dentro do script porque ele escreve,
-- e o resto daqui é só leitura.
-- ============================================================================
CREATE OR REPLACE FUNCTION pg_temp.diagnostico_indice()
RETURNS TABLE (resultado text) AS $fn$
DECLARE
  vec         text;
  plano_json  json;
  plano       jsonb;
  usou_hnsw   boolean;
  usou_seq    boolean;
  linhas      int;
BEGIN
  SELECT embedding::text INTO vec
  FROM "DocumentChunk"
  WHERE embedding IS NOT NULL
  LIMIT 1;

  IF vec IS NULL THEN
    RETURN QUERY SELECT 'Não há chunk com embedding. Rode a geração de embeddings antes de diagnosticar.'::text;
    RETURN;
  END IF;

  -- Mesmo valor que a rota usa (RAG_EF_SEARCH em app/api/chat/route.ts).
  SET LOCAL hnsw.ef_search = 120;

  -- enable_seqscan fica LIGADO de propósito: o que se quer saber é qual caminho o
  -- planner escolhe de verdade, não se o índice funciona quando forçado.
  EXECUTE format($q$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT dc.content, dc."documentId",
           1 - (dc.embedding <=> %1$L::vector) AS score,
           d.category, d.name
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d.id = dc."documentId"
    WHERE d.active = true
      AND (dc.embedding <=> %1$L::vector) < 0.6
    ORDER BY dc.embedding <=> %1$L::vector
    LIMIT 30
  $q$, vec) INTO plano_json;

  plano := plano_json::jsonb;
  usou_hnsw := plano::text LIKE '%documentchunk_embedding_hnsw_idx%';
  usou_seq  := plano::text LIKE '%"Node Type": "Seq Scan"%'
            OR plano::text LIKE '%"Node Type":"Seq Scan"%';
  linhas    := (plano -> 0 -> 'Plan' ->> 'Actual Rows')::int;

  RETURN QUERY SELECT format('usou o índice HNSW ....... %s',
    CASE WHEN usou_hnsw THEN 'SIM' ELSE 'NÃO' END);
  RETURN QUERY SELECT format('varredura sequencial ..... %s',
    CASE WHEN usou_seq THEN 'SIM' ELSE 'NÃO' END);
  RETURN QUERY SELECT format('candidatos devolvidos .... %s de 30 pedidos', linhas);
  RETURN QUERY SELECT '';

  IF usou_hnsw THEN
    RETURN QUERY SELECT 'VEREDICTO: o índice está em uso. A queda de recall que a #61 descreve era real,'::text;
    RETURN QUERY SELECT 'e a taxa de fallback deve cair. Compare na seção 3.'::text;
    IF linhas < 30 THEN
      RETURN QUERY SELECT '';
      RETURN QUERY SELECT format('ATENÇÃO: voltaram só %s candidatos de 30. O filtro pós-índice está', linhas);
      RETURN QUERY SELECT 'descartando muito. Se a taxa de fallback continuar alta, subir RAG_EF_SEARCH'::text;
      RETURN QUERY SELECT 'acima de 120 em app/api/chat/route.ts é a próxima alavanca.'::text;
    END IF;
  ELSE
    RETURN QUERY SELECT 'VEREDICTO: o planner preferiu varredura sequencial ao índice.'::text;
    RETURN QUERY SELECT ''::text;
    RETURN QUERY SELECT 'Isso NÃO é defeito: a sequencial é exata, dá recall de 100% e nessa escala'::text;
    RETURN QUERY SELECT 'é barata. Mas tem uma consequência importante: o índice não estava sendo'::text;
    RETURN QUERY SELECT 'usado, logo ele NÃO era a causa da taxa de fallback atual. Não atribua'::text;
    RETURN QUERY SELECT 'melhora nenhuma à migração da #61, e procure a causa na seção 4.'::text;
    RETURN QUERY SELECT 'O valor da migração passa a ser preventivo, para quando o corpus crescer.'::text;
  END IF;

  RETURN QUERY SELECT '';
  RETURN QUERY SELECT '--- nós do plano, do mais externo para o mais interno ---';
  -- Só os tipos de nó, na ordem em que aparecem. O plano completo traz o vetor de
  -- 1024 dimensões embutido e sozinho gera centenas de KB, o que é inútil num
  -- editor de banco.
  RETURN QUERY
    SELECT format('  %s. %s', t.ord, t.m[1])
    FROM regexp_matches(plano::text, '"Node Type": ?"([^"]+)"', 'g')
         WITH ORDINALITY AS t(m, ord)
    ORDER BY t.ord;

  RETURN QUERY SELECT '';
  RETURN QUERY SELECT format('tempo de execução: %s ms',
    round((plano -> 0 ->> 'Execution Time')::numeric, 1));
END
$fn$ LANGUAGE plpgsql;

SELECT * FROM pg_temp.diagnostico_indice();


-- ============================================================================
-- SEÇÃO 3: antes e depois do deploy
--
-- >>> EDITE A LINHA DO `deploy` LOGO ABAIXO. <<<
--
-- As janelas têm o mesmo tamanho de propósito. Comparar 3 dias contra 14 é o erro
-- mais fácil de cometer aqui, e ele infla ou esconde qualquer diferença.
--
-- O "antes" sai em retrospecto: as colunas de token, ragFallback e ragTopScore são
-- por mensagem e têm createdAt, então o baseline não precisava ter sido coletado
-- na época.
-- ============================================================================
-- Confirma quais janelas serão comparadas, quanto dado existe em cada uma, e se a
-- comparação já é válida. LEIA ESTA SAÍDA ANTES da tabela de métricas: ela diz se
-- os números abaixo significam algo ou se ainda falta tráfego.
--
-- Use a HORA do deploy, não só a data. Se você deployou às 14h e colocar 00:00,
-- as horas entre 00h e 14h de hoje entram na janela "antes" sendo tráfego já
-- pós-deploy, e a comparação fica contaminada nas duas pontas.
WITH params AS (
  SELECT '2026-07-30 00:00:00'::timestamp AS deploy, 7 AS dias   -- <<< EDITE AQUI
),
j AS (
  SELECT 'antes'  AS janela, deploy - (dias || ' days')::interval AS inicio, deploy AS fim FROM params
  UNION ALL
  SELECT 'depois' AS janela, deploy AS inicio, deploy + (dias || ' days')::interval AS fim FROM params
),
c AS (
  SELECT j.janela, j.inicio, j.fim,
    (SELECT count(*) FROM "Message" m
      WHERE m."createdAt" >= j.inicio AND m."createdAt" < j.fim
        AND coalesce(m."operatorName", '') <> '__eval__') AS mensagens
  FROM j
)
SELECT
  janela, inicio, fim, mensagens,
  CASE
    WHEN mensagens = 0 AND fim <= now()
      THEN 'ZERO mensagens numa janela ja fechada: a data do deploy esta errada'
    WHEN fim > now()
      THEN format('janela AINDA ABERTA, faltam %s. A secao 3 sai parcial: %s mensagens ate agora.',
                  justify_interval(date_trunc('minute', fim - now())), mensagens)
    WHEN mensagens < 30
      THEN format('amostra pequena (%s mensagens): variacao percentual e mais ruido que sinal', mensagens)
    ELSE format('ok, %s mensagens', mensagens)
  END AS leitura
FROM c
ORDER BY janela;

WITH params AS (
  SELECT
    '2026-07-30 00:00:00'::timestamp AS deploy,   -- <<< EDITE AQUI (mesma data de cima)
    7                                AS dias     -- dias de cada lado
),
janelas AS (
  SELECT 'antes'  AS w, deploy - (dias || ' days')::interval AS ini, deploy                            AS fim FROM params
  UNION ALL
  SELECT 'depois' AS w, deploy                               AS ini, deploy + (dias || ' days')::interval AS fim FROM params
),
-- Espelho de MODEL_PRICING em lib/pricing.ts. USD por 1M de tokens.
precos AS (
  SELECT * FROM (VALUES
    ('claude-sonnet-4-6',         3.00, 15.00, 0.30, 3.75, 6.00),
    ('claude-haiku-4-5-20251001', 1.00,  5.00, 0.10, 1.25, 2.00)
  ) AS t(model, p_in, p_out, p_read, p_cc5m, p_cc1h)
),
base AS (
  SELECT
    j.w,
    m."inputTokens", m."outputTokens", m."cacheReadTokens", m."cacheCreationTokens",
    m."ragFallback", m."ragTopScore", m."stopReason", m."responseTimeMs",
    -- Modelo sem preço cadastrado cai no do chat, como pricingFor() faz.
    CASE WHEN m.model IN ('claude-sonnet-4-6', 'claude-haiku-4-5-20251001')
         THEN m.model ELSE 'claude-sonnet-4-6' END AS model_efetivo,
    -- Recorte de 1 h dentro do total, com clamp para uma linha inconsistente não
    -- cobrar acima do total. Mesma lógica de splitCacheCreation() em lib/pricing.ts.
    least(coalesce(m."cacheCreation1hTokens", 0), coalesce(m."cacheCreationTokens", 0)) AS cc1h
  FROM "Message" m
  JOIN janelas j
    ON m."createdAt" >= j.ini AND m."createdAt" < j.fim
  -- Mensagens do harness de avaliação distorcem a média: uma rodada de 50 casos
  -- numa janela de 120 mensagens chega a inverter a conclusão.
  WHERE coalesce(m."operatorName", '') <> '__eval__'
),
linhas AS (
  SELECT
    b.*,
    greatest(0, coalesce(b."cacheCreationTokens", 0) - b.cc1h) AS cc5m,
    (coalesce(b."inputTokens", 0)     / 1e6) * p.p_in
  + (coalesce(b."outputTokens", 0)    / 1e6) * p.p_out
  + (coalesce(b."cacheReadTokens", 0) / 1e6) * p.p_read
  + (greatest(0, coalesce(b."cacheCreationTokens", 0) - b.cc1h) / 1e6) * p.p_cc5m
  + (b.cc1h / 1e6) * p.p_cc1h                                  AS custo
  FROM base b
  JOIN precos p ON p.model = b.model_efetivo
),
agg AS (
  SELECT
    w,
    count(*)::numeric                                                        AS n,
    sum(custo)::numeric                                                      AS custo_total,
    avg(custo)::numeric                                                      AS custo_msg,
    sum(coalesce("cacheReadTokens", 0))::numeric                             AS t_read,
    sum(coalesce("inputTokens", 0))::numeric                                 AS t_in,
    sum(coalesce("cacheCreationTokens", 0))::numeric                         AS t_cc,
    sum(cc5m)::numeric                                                       AS t_cc5m,
    sum(cc1h)::numeric                                                       AS t_cc1h,
    avg(CASE WHEN "ragFallback" THEN 1 ELSE 0 END)::numeric                  AS taxa_fallback,
    avg("ragTopScore") FILTER (WHERE NOT "ragFallback" AND "ragTopScore" IS NOT NULL)::numeric AS avg_rag,
    avg(coalesce("outputTokens", 0))::numeric                                AS out_msg,
    avg("responseTimeMs")::numeric                                           AS ms_medio,
    -- percentile_disc, e não _cont: devolve um valor que existe na amostra, do
    -- mesmo jeito que o nearest-rank de lib/metrics.ts. Com _cont haveria
    -- interpolação e o p95 daqui divergiria do `npm run measure` em 1 ms, o que
    -- só serviria para alguém desconfiar de qual dos dois está certo.
    percentile_disc(0.95) WITHIN GROUP (ORDER BY "responseTimeMs")::numeric   AS ms_p95,
    avg(CASE WHEN "stopReason" = 'max_tokens' THEN 1 ELSE 0 END)::numeric    AS taxa_trunc,
    sum(CASE WHEN "stopReason" IN ('timeout', 'error') THEN 1 ELSE 0 END)::numeric AS falhas
  FROM linhas
  GROUP BY w
),
piv AS (
  SELECT
    max(n)             FILTER (WHERE w = 'antes')  AS n_b,             max(n)             FILTER (WHERE w = 'depois') AS n_a,
    max(custo_total)   FILTER (WHERE w = 'antes')  AS ct_b,            max(custo_total)   FILTER (WHERE w = 'depois') AS ct_a,
    max(custo_msg)     FILTER (WHERE w = 'antes')  AS cm_b,            max(custo_msg)     FILTER (WHERE w = 'depois') AS cm_a,
    max(t_read)        FILTER (WHERE w = 'antes')  AS r_b,             max(t_read)        FILTER (WHERE w = 'depois') AS r_a,
    max(t_in + t_read + t_cc) FILTER (WHERE w = 'antes') AS il_b,      max(t_in + t_read + t_cc) FILTER (WHERE w = 'depois') AS il_a,
    max(t_cc5m)        FILTER (WHERE w = 'antes')  AS c5_b,            max(t_cc5m)        FILTER (WHERE w = 'depois') AS c5_a,
    max(t_cc1h)        FILTER (WHERE w = 'antes')  AS c1_b,            max(t_cc1h)        FILTER (WHERE w = 'depois') AS c1_a,
    max(taxa_fallback) FILTER (WHERE w = 'antes')  AS fb_b,            max(taxa_fallback) FILTER (WHERE w = 'depois') AS fb_a,
    max(avg_rag)       FILTER (WHERE w = 'antes')  AS rs_b,            max(avg_rag)       FILTER (WHERE w = 'depois') AS rs_a,
    max(out_msg)       FILTER (WHERE w = 'antes')  AS ot_b,            max(out_msg)       FILTER (WHERE w = 'depois') AS ot_a,
    max(ms_medio)      FILTER (WHERE w = 'antes')  AS mm_b,            max(ms_medio)      FILTER (WHERE w = 'depois') AS mm_a,
    max(ms_p95)        FILTER (WHERE w = 'antes')  AS p9_b,            max(ms_p95)        FILTER (WHERE w = 'depois') AS p9_a,
    max(taxa_trunc)    FILTER (WHERE w = 'antes')  AS tt_b,            max(taxa_trunc)    FILTER (WHERE w = 'depois') AS tt_a,
    max(falhas)        FILTER (WHERE w = 'antes')  AS fa_b,            max(falhas)        FILTER (WHERE w = 'depois') AS fa_a
  FROM agg
)
-- Os valores entram crus na lista abaixo e são arredondados só na exibição. A
-- variação é calculada do valor cru: derivá-la dos números já arredondados fazia
-- esta tabela discordar do `npm run measure` na casa decimal, e uma divergência
-- assim só serve para alguém desconfiar de qual das duas ferramentas está certa.
SELECT
  v.ordem,
  v.metrica,
  round(v.antes,  v.decimais) AS antes,
  round(v.depois, v.decimais) AS depois,
  CASE
    WHEN v.antes IS NULL OR v.depois IS NULL                      THEN '-'
    WHEN v.antes = 0 AND v.depois = 0                             THEN 'igual'
    WHEN v.antes = 0                                              THEN 'saiu de zero'
    WHEN round(((v.depois - v.antes) / abs(v.antes)) * 100, 1) = 0 THEN 'igual'
    ELSE format('%s%s%%',
      CASE WHEN v.depois > v.antes THEN '+' ELSE '' END,
      round(((v.depois - v.antes) / abs(v.antes)) * 100, 1))
  END                         AS variacao,
  v.melhor_quando
FROM piv
CROSS JOIN LATERAL (VALUES
  ( 1, 'mensagens',                     piv.n_b,  piv.n_a,  0, 'contexto'),
  ( 2, 'custo total (USD)',             piv.ct_b, piv.ct_a, 4, 'menor'),
  ( 3, 'custo por mensagem (USD)',      piv.cm_b, piv.cm_a, 5, 'menor'),
  ( 4, 'cache hit rate (%)',            100 * piv.r_b / nullif(piv.il_b, 0),
                                        100 * piv.r_a / nullif(piv.il_a, 0), 1, 'maior'),
  ( 5, 'gravacao cache 5 min (tokens)', piv.c5_b, piv.c5_a, 0, 'contexto'),
  ( 6, 'gravacao cache 1 h (tokens)',   piv.c1_b, piv.c1_a, 0, 'contexto'),
  ( 7, 'taxa de fallback (%)',          100 * piv.fb_b, 100 * piv.fb_a, 1, 'menor'),
  ( 8, 'avgRagScore',                   piv.rs_b, piv.rs_a, 4, 'maior'),
  ( 9, 'tokens de saida por mensagem',  piv.ot_b, piv.ot_a, 0, 'menor'),
  (10, 'latencia media (ms)',           piv.mm_b, piv.mm_a, 0, 'menor'),
  (11, 'latencia p95 (ms)',             piv.p9_b, piv.p9_a, 0, 'menor'),
  (12, 'taxa de truncamento (%)',       100 * piv.tt_b, 100 * piv.tt_a, 1, 'menor'),
  (13, 'requisicoes que falharam',      piv.fa_b, piv.fa_a, 0, 'menor')
) AS v(ordem, metrica, antes, depois, decimais, melhor_quando)
ORDER BY v.ordem;


-- ============================================================================
-- SEÇÃO 4: por que o fallback aconteceu
--
-- Só interessa se a taxa de fallback continuar alta. Separa as duas causas, que
-- pedem correções opostas: candidato fraco aponta para o corpus, ausência de
-- candidato aponta para o índice ou para o filtro de cliente.
-- ============================================================================
-- Estas duas olham os últimos 7 dias, e não a janela do deploy, de propósito: a
-- pergunta aqui é "por que o fallback está acontecendo AGORA", que é sobre o
-- estado atual. Assim também não há data para editar.
SELECT
  CASE
    WHEN "ragTopScore" IS NULL          THEN '1. sem candidato nenhum (indice ou filtro de cliente)'
    WHEN "ragTopScore" >= 0.50          THEN '2. candidato passou perto, entre 0,50 e o piso de 0,55 (piso apertado)'
    WHEN "ragTopScore" >= 0.40          THEN '3. candidato fraco, 0,40 a 0,50 (documentacao provavelmente nao cobre)'
    ELSE                                     '4. candidato muito fraco, abaixo de 0,40 (corpus nao cobre, fallback correto)'
  END                                        AS causa,
  count(*)                                   AS mensagens,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_dos_fallbacks
FROM "Message" m
WHERE m."ragFallback"
  AND coalesce(m."operatorName", '') <> '__eval__'
  AND m."createdAt" >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1;

-- Fallback por cliente detectado, para ver se o problema é de um cliente só.
SELECT
  coalesce(m."detectedClient", 'nao identificado')            AS cliente,
  count(*)                                                    AS mensagens,
  sum(CASE WHEN m."ragFallback" THEN 1 ELSE 0 END)            AS fallbacks,
  round(100.0 * avg(CASE WHEN m."ragFallback" THEN 1 ELSE 0 END), 1) AS taxa_pct,
  round(avg(m."ragTopScore") FILTER (WHERE NOT m."ragFallback")::numeric, 4) AS avg_rag_score
FROM "Message" m
WHERE coalesce(m."operatorName", '') <> '__eval__'
  AND m."createdAt" >= now() - interval '7 days'
GROUP BY 1
ORDER BY taxa_pct DESC;


-- ============================================================================
-- SEÇÃO 5: a coluna nova da #64 está sendo preenchida?
--
-- Se `com_recorte_1h` ficar em zero depois do deploy, o TTL de 1 h não está sendo
-- aplicado, ou a API não está devolvendo a quebra por TTL. Nesse caso o custo do
-- dashboard está subestimado, porque toda gravação seria cobrada a 1,25x.
-- ============================================================================
-- A janela começa NO DEPLOY, e não "nos últimos 2 dias". Com um recorte de 2 dias
-- logo após o deploy, as mensagens de antes (que gravaram cache a 5 min, com a
-- coluna nula por não existir ainda) entram na conta e o veredicto acusa
-- "PROBLEMA" num deploy que está perfeito. Falso alarme que manda depurar o que
-- está certo.
WITH params AS (
  SELECT '2026-07-30 00:00:00'::timestamp AS deploy   -- <<< EDITE AQUI (mesma data das outras)
),
pos AS (
  SELECT m.*
  FROM "Message" m, params p
  WHERE m."createdAt" >= p.deploy
    AND coalesce(m."operatorName", '') <> '__eval__'
)
SELECT
  count(*)                                                        AS mensagens_desde_o_deploy,
  count(*) FILTER (WHERE coalesce("cacheCreationTokens", 0) > 0)   AS com_gravacao_de_cache,
  count(*) FILTER (WHERE coalesce("cacheCreation1hTokens", 0) > 0) AS com_recorte_1h,
  count(*) FILTER (WHERE coalesce("cacheReadTokens", 0) > 0)       AS com_leitura_de_cache,
  CASE
    WHEN count(*) = 0
      THEN 'nenhuma mensagem desde o deploy: mande algumas perguntas pelo chat e rode de novo'
    WHEN count(*) FILTER (WHERE coalesce("cacheCreationTokens", 0) > 0) = 0
         AND count(*) FILTER (WHERE coalesce("cacheReadTokens", 0) > 0) > 0
      THEN 'OK: so houve LEITURA de cache, nenhuma gravacao. E o melhor cenario, o prefixo ja estava quente.'
    WHEN count(*) FILTER (WHERE coalesce("cacheCreationTokens", 0) > 0) = 0
      THEN 'ATENCAO: nem gravacao nem leitura de cache. O prefixo pode ter caido abaixo do minimo cacheavel de 1024 tokens.'
    WHEN count(*) FILTER (WHERE coalesce("cacheCreation1hTokens", 0) > 0) = 0
      THEN 'PROBLEMA: houve gravacao de cache e nenhuma marcada como 1 h. O deploy do TTL nao subiu, ou a API nao devolveu a quebra por TTL. O custo do dashboard esta subestimado.'
    ELSE 'OK: gravacoes de 1 h registradas e precificadas a 2,00x'
  END                                                             AS leitura
FROM pos;
