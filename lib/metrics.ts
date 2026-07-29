/**
 * Métricas agregadas de mensagens: custo, cache, saúde do RAG e latência.
 *
 * Por que este módulo existe: as fórmulas viviam só dentro de
 * `app/api/admin/analytics/route.ts`, que é uma rota HTTP. Comparar duas janelas
 * de tempo (antes e depois de uma mudança de custo) exigia abrir o dashboard,
 * trocar o filtro de período e anotar números na mão, o que não é reproduzível e
 * deixa passar o erro mais fácil de cometer nesse tipo de comparação: comparar
 * janelas de tamanhos diferentes. Pior, um script que recalculasse as mesmas
 * médias por fora acabaria divergindo do dashboard na primeira mudança de preço.
 *
 * Então as fórmulas moram aqui, e tanto a rota quanto `scripts/measure.ts` leem
 * daqui. Se um número do script discordar do dashboard, é bug de verdade, não
 * duas contas diferentes.
 */

import {
  LEGACY_MESSAGE_MODEL,
  costUsd,
  costWithoutCacheUsd,
  splitCacheCreation,
  type TokenUsage,
} from '@/lib/pricing'

/** O mínimo que uma linha de `Message` precisa expor para entrar nas contas. */
export interface MetricRow extends TokenUsage {
  model: string | null
  ragFallback: boolean
  ragTopScore: number | null
  stopReason: string | null
  responseTimeMs: number
}

/** Uso de tokens somado por modelo, para precificar cada balde pelo seu preço. */
export interface ModelBucket extends TokenUsage {
  messages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheCreation1hTokens: number
}

export interface MessageMetrics {
  totalMessages: number

  totalInput: number
  totalOutput: number
  totalCacheRead: number
  /** Total gravado no cache, somando as duas faixas de TTL. */
  totalCacheCreation: number
  totalCacheCreation5m: number
  totalCacheCreation1h: number

  estimatedCostUsd: number
  costWithoutCacheTotalUsd: number
  cacheSavingsUsd: number
  costPerMessageUsd: number | null

  /** Fração dos tokens de entrada que veio de leitura de cache. */
  cacheHitRate: number

  fallbackMessages: number
  /** Mensagens que usaram trechos de RAG e têm score registrado. */
  ragMessages: number
  fallbackRate: number
  avgRagScore: number | null

  avgOutputTokens: number | null
  avgResponseMs: number
  p95ResponseMs: number

  truncatedCount: number
  truncationRate: number
  failedCount: number

  /** Por modelo, na ordem em que os modelos apareceram nas linhas. */
  buckets: Map<string, ModelBucket>
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  // Nearest-rank: o índice nunca sai do array, então não há interpolação nem
  // caso especial para amostra de tamanho 1.
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1
  return sortedValues[Math.min(Math.max(rank, 0), sortedValues.length - 1)]
}

/**
 * Agrega um conjunto de mensagens. Uma lista vazia devolve zeros, com as médias
 * que não fazem sentido sem amostra (`avgRagScore`, `costPerMessageUsd`,
 * `avgOutputTokens`) em `null`, para que quem exibe saiba distinguir "zero" de
 * "não há dado".
 */
export function computeMessageMetrics(rows: MetricRow[]): MessageMetrics {
  const totalMessages = rows.length

  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheCreation = 0
  let totalCacheCreation1h = 0

  const buckets = new Map<string, ModelBucket>()

  for (const m of rows) {
    totalInput += m.inputTokens ?? 0
    totalOutput += m.outputTokens ?? 0
    totalCacheRead += m.cacheReadTokens ?? 0
    totalCacheCreation += m.cacheCreationTokens ?? 0
    totalCacheCreation1h += splitCacheCreation(m).tokens1h

    const key = m.model ?? LEGACY_MESSAGE_MODEL
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation1hTokens: 0,
      }
      buckets.set(key, bucket)
    }
    bucket.messages += 1
    bucket.inputTokens += m.inputTokens ?? 0
    bucket.outputTokens += m.outputTokens ?? 0
    bucket.cacheReadTokens += m.cacheReadTokens ?? 0
    bucket.cacheCreationTokens += m.cacheCreationTokens ?? 0
    // Somado pelo recorte já normalizado da linha, não pela coluna crua: uma
    // linha inconsistente (recorte de 1 h maior que o total) seria contada aqui
    // acima do total e faria o balde cobrar mais que o devido.
    bucket.cacheCreation1hTokens += splitCacheCreation(m).tokens1h
  }

  let estimatedCostUsd = 0
  let costWithoutCacheTotalUsd = 0
  for (const [model, bucket] of buckets) {
    estimatedCostUsd += costUsd(bucket, model)
    costWithoutCacheTotalUsd += costWithoutCacheUsd(bucket, model)
  }

  const totalInputLike = totalInput + totalCacheRead + totalCacheCreation

  const fallbackRows = rows.filter((m) => m.ragFallback)
  // Só mensagens sem fallback entram na média de score: numa mensagem que caiu
  // no fallback o score registrado é do candidato que foi recusado, então
  // incluí-lo puxaria a média justamente para baixo quando o RAG piora.
  const ragRows = rows.filter((m) => !m.ragFallback && m.ragTopScore != null)

  const sortedMs = rows.map((m) => m.responseTimeMs).sort((a, b) => a - b)

  const truncatedCount = rows.filter((m) => m.stopReason === 'max_tokens').length
  const failedCount = rows.filter(
    (m) => m.stopReason === 'timeout' || m.stopReason === 'error'
  ).length

  return {
    totalMessages,

    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreation,
    totalCacheCreation5m: totalCacheCreation - totalCacheCreation1h,
    totalCacheCreation1h,

    estimatedCostUsd,
    costWithoutCacheTotalUsd,
    cacheSavingsUsd: costWithoutCacheTotalUsd - estimatedCostUsd,
    costPerMessageUsd: totalMessages > 0 ? estimatedCostUsd / totalMessages : null,

    cacheHitRate: totalInputLike > 0 ? totalCacheRead / totalInputLike : 0,

    fallbackMessages: fallbackRows.length,
    ragMessages: ragRows.length,
    fallbackRate: totalMessages > 0 ? fallbackRows.length / totalMessages : 0,
    avgRagScore:
      ragRows.length > 0
        ? ragRows.reduce((sum, m) => sum + (m.ragTopScore ?? 0), 0) / ragRows.length
        : null,

    avgOutputTokens: totalMessages > 0 ? totalOutput / totalMessages : null,
    avgResponseMs:
      totalMessages > 0
        ? Math.round(rows.reduce((sum, m) => sum + m.responseTimeMs, 0) / totalMessages)
        : 0,
    p95ResponseMs: percentile(sortedMs, 95),

    truncatedCount,
    truncationRate: totalMessages > 0 ? truncatedCount / totalMessages : 0,
    failedCount,

    buckets,
  }
}
