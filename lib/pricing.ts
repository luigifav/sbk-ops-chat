/**
 * Tabela de preços dos modelos de IA usados pela aplicação e helpers de custo.
 *
 * Por que este módulo existe: o dashboard de analytics precificava tudo com
 * quatro constantes fixas do Sonnet declaradas no meio da rota. Como `Message`
 * não gravava o modelo que atendeu cada mensagem, qualquer troca de modelo
 * passaria a recalcular o histórico inteiro com o preço errado, sem erro nem
 * aviso. Os IDs dos modelos vivem aqui junto dos preços justamente para que
 * trocar de modelo obrigue a mexer nesta tabela.
 *
 * Todos os valores em USD por 1M de tokens. Os multiplicadores de cache são os
 * da Anthropic: leitura 0,10x da entrada e gravação 1,25x da entrada com TTL de
 * 5 min ou 2,00x com TTL de 1 h.
 *
 * Os dois preços de gravação coexistem porque o TTL mudou no meio da série
 * histórica: os blocos estáveis do system passaram a usar `ttl: '1h'` (issue
 * #64), mas as mensagens gravadas antes disso pagaram 1,25x. Precificar tudo a
 * 2,00x reescreveria o passado para cima e inventaria uma economia na
 * comparação antes/depois; precificar tudo a 1,25x subestimaria toda gravação
 * nova em 37,5%. Por isso `Message` guarda quanto de `cacheCreationTokens` foi
 * gravado com TTL de 1 h, e cada parcela é cobrada pelo seu próprio preço.
 */

export interface ModelPricing {
  /** Tokens de entrada não cacheados. */
  input: number
  /** Tokens de saída. */
  output: number
  /** Tokens lidos de um bloco de cache existente (0,10x da entrada). */
  cacheRead: number
  /** Tokens gravados no cache com TTL de 5 min (1,25x da entrada). */
  cacheCreation: number
  /** Tokens gravados no cache com TTL de 1 h (2,00x da entrada). */
  cacheCreation1h: number
}

/** Modelo que atende o chat (`app/api/chat/route.ts`). */
export const CHAT_MODEL = 'claude-sonnet-4-6'

/** Modelo que classifica o tema das perguntas (`lib/theme.ts`). */
export const THEME_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Modelo de embedding do RAG (`lib/embeddings.ts`). Registrado aqui como
 * referência; o consumo do Voyage ainda não é contabilizado em nenhuma tabela
 * (ver issue #69, item 3).
 */
export const EMBEDDING_MODEL = 'voyage-3'

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheCreation: 3.75,
    cacheCreation1h: 6.0,
  },
  'claude-haiku-4-5-20251001': {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheCreation: 1.25,
    cacheCreation1h: 2.0,
  },
}

/** Rótulos curtos para exibição no dashboard. */
export const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

/**
 * Modelo assumido para as mensagens gravadas antes da coluna `Message.model`
 * existir. Todas foram atendidas pelo Sonnet 4.6, então o histórico continua
 * precificado corretamente e a comparação antes/depois não fica ambígua.
 */
export const LEGACY_MESSAGE_MODEL = CHAT_MODEL

// Evita repetir o mesmo aviso a cada mensagem do período ao renderizar o
// dashboard: um modelo desconhecido é problema de configuração, não de dado.
const warnedUnknownModels = new Set<string>()

/**
 * Preços de um modelo. Um modelo fora da tabela cai no preço do modelo de chat
 * e emite aviso — melhor um número aproximado com sinal no log do que um custo
 * zerado silencioso.
 */
export function pricingFor(model: string | null | undefined): ModelPricing {
  if (!model) return MODEL_PRICING[LEGACY_MESSAGE_MODEL]

  const pricing = MODEL_PRICING[model]
  if (pricing) return pricing

  if (!warnedUnknownModels.has(model)) {
    warnedUnknownModels.add(model)
    console.warn(
      `[pricing] Modelo sem preço cadastrado em lib/pricing.ts: "${model}". ` +
        `Usando o preço de ${LEGACY_MESSAGE_MODEL} — o custo estimado está aproximado.`
    )
  }
  return MODEL_PRICING[LEGACY_MESSAGE_MODEL]
}

/** Nome de exibição do modelo (cai no próprio id quando não há rótulo). */
export function labelFor(model: string | null | undefined): string {
  if (!model) return `${MODEL_LABELS[LEGACY_MESSAGE_MODEL]} (não registrado)`
  return MODEL_LABELS[model] ?? model
}

export interface TokenUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  /** Total gravado no cache, somando as duas faixas de TTL. */
  cacheCreationTokens?: number | null
  /**
   * Parcela de `cacheCreationTokens` gravada com TTL de 1 h. Ausente ou nula nas
   * linhas anteriores ao TTL de 1 h, que são integralmente de 5 min.
   */
  cacheCreation1hTokens?: number | null
}

/**
 * Divide o total gravado no cache entre as duas faixas de TTL. A parcela de 5
 * min é derivada por subtração em vez de gravada, para que `cacheCreationTokens`
 * siga sendo o total e nenhuma soma histórica precise ser reinterpretada. O
 * `Math.max` protege contra uma linha inconsistente devolver um 5m negativo.
 */
export function splitCacheCreation(usage: TokenUsage): { tokens5m: number; tokens1h: number } {
  const total = usage.cacheCreationTokens ?? 0
  const tokens1h = Math.min(usage.cacheCreation1hTokens ?? 0, total)
  return { tokens5m: Math.max(0, total - tokens1h), tokens1h }
}

/** Custo em USD do uso de tokens informado, precificado pelo modelo. */
export function costUsd(usage: TokenUsage, model: string | null | undefined): number {
  const p = pricingFor(model)
  const { tokens5m, tokens1h } = splitCacheCreation(usage)
  return (
    ((usage.inputTokens ?? 0) / 1_000_000) * p.input +
    ((usage.outputTokens ?? 0) / 1_000_000) * p.output +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * p.cacheRead +
    (tokens5m / 1_000_000) * p.cacheCreation +
    (tokens1h / 1_000_000) * p.cacheCreation1h
  )
}

/**
 * Custo que o mesmo uso teria sem nenhum cache: todo token de cache (lido ou
 * gravado) cobrado como entrada normal. A diferença contra `costUsd` é a
 * economia atribuída ao cache de prompt.
 *
 * A faixa de TTL não entra na conta aqui: sem cache não existe gravação, e as
 * duas parcelas colapsam no mesmo preço de entrada. Por isso o cálculo usa
 * `cacheCreationTokens` (o total) direto, sem dividir por TTL.
 */
export function costWithoutCacheUsd(
  usage: TokenUsage,
  model: string | null | undefined
): number {
  const p = pricingFor(model)
  const inputLike =
    (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheCreationTokens ?? 0)
  return (inputLike / 1_000_000) * p.input + ((usage.outputTokens ?? 0) / 1_000_000) * p.output
}
