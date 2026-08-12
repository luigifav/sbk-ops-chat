/**
 * Parâmetros de geração do chat, roteados pelo modo da requisição (issue #65).
 *
 * O workload não é homogêneo. Há dois modos bem distintos, já separados no código
 * pela flag `isPetition`:
 *
 * - Pergunta operacional curta, que domina o volume. A resposta esperada tem
 *   poucas linhas, e a regra 4 do prompt base já pede "direto e objetivo".
 * - Classificação de petição inicial, que é extração estruturada de vários campos
 *   a partir de um documento jurídico, com códigos que precisam sair corretos.
 *   É a tarefa de maior valor do produto.
 *
 * Aplicar um `effort` só para os dois é errado nas duas direções: `low` uniforme
 * degradaria a classificação, e `high` uniforme paga a mais nas perguntas simples.
 * Daí os valores serem por modo.
 *
 * IMPORTANTE, sobre os defaults: eles reproduzem exatamente o comportamento de
 * hoje (`effort` alto nos dois modos, que é o default do Sonnet 4.6, e 2048
 * tokens de saída nos dois). Isso é deliberado. A própria issue #65 manda escolher
 * o `effort` pelo par acerto e custo medido no harness de avaliação (issue #60), e
 * enquanto esse harness não existir, baixar o `effort` no escuro seria a aposta
 * que a #60 foi aberta para evitar. Então este módulo entrega o mecanismo e deixa
 * a escolha para quem tiver o número na mão, sem precisar de deploy: os valores
 * vêm da tabela `Setting`.
 *
 * Chaves em `Setting` (todas opcionais, ausência significa usar o default):
 *
 *   chat_effort_petition       low | medium | high | max
 *   chat_effort_simple         low | medium | high | max
 *   chat_max_tokens_petition   inteiro entre 256 e 8192
 *   chat_max_tokens_simple     inteiro entre 256 e 8192
 *
 * Um valor inválido nunca derruba o chat: emite aviso no log e cai no default.
 * Uma configuração errada no painel não deve virar indisponibilidade.
 */

import { prisma } from '@/lib/prisma'

/**
 * Níveis aceitos pelo modelo do chat.
 *
 * NÃO inclui `xhigh` de propósito. O `xhigh` só existe a partir do Opus 4.7; o
 * Sonnet 4.6, que é o CHAT_MODEL (lib/pricing.ts), aceita apenas low, medium,
 * high e max. Enquanto ele constava aqui, um valor `xhigh` gravado em `Setting`
 * passava na validação local, ia direto para `output_config` na rota e era
 * rejeitado pela API: a exceção estourava dentro do ReadableStream e derrubava
 * TODAS as mensagens daquele modo, o oposto da promessa de que configuração
 * errada no painel nunca vira indisponibilidade.
 *
 * Ao trocar CHAT_MODEL, revise esta lista contra os níveis do modelo novo. Ela é
 * a última barreira entre o painel e a API.
 */
export type Effort = 'low' | 'medium' | 'high' | 'max'

const VALID_EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'max']

/** Teto de segurança para `max_tokens` vindo de configuração. */
const MIN_MAX_TOKENS = 256
const MAX_MAX_TOKENS = 8192

export interface ChatTuning {
  effort: Effort
  maxTokens: number
}

/**
 * Defaults por modo. Iguais ao comportamento anterior à issue #65, de propósito.
 *
 * Quando o harness estiver pronto, os dois primeiros candidatos a mexer são:
 * `chat_effort_simple` para `low` ou `medium`, que é onde está o volume e
 * portanto a economia; e `chat_max_tokens_petition` para 4096, que é a alavanca
 * contra o truncamento das classificações longas, já visível hoje na taxa de
 * truncamento do dashboard.
 */
export const TUNING_DEFAULTS: Record<'petition' | 'simple', ChatTuning> = {
  petition: { effort: 'high', maxTokens: 2048 },
  simple: { effort: 'high', maxTokens: 2048 },
}

const SETTING_KEYS = [
  'chat_effort_petition',
  'chat_effort_simple',
  'chat_max_tokens_petition',
  'chat_max_tokens_simple',
] as const

// Cache em memória para não somar uma leitura de Setting a cada mensagem. O TTL
// curto é o preço de "ajustar sem deploy": uma mudança no painel entra em vigor
// em até TTL_MS, não instantaneamente. Como o processo é serverless e some, o
// cache é por instância e não precisa de invalidação.
const TTL_MS = 60_000
let cache: { at: number; values: Map<string, string> } | null = null

async function loadSettings(): Promise<Map<string, string>> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.values

  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [...SETTING_KEYS] } },
      select: { key: true, value: true },
    })
    const values = new Map(rows.map((r) => [r.key, r.value]))
    cache = { at: now, values }
    return values
  } catch (err) {
    console.warn('[chatTuning] Falha ao ler Setting, usando defaults:', err)
    // Não grava no cache: uma falha transitória não deve fixar os defaults por
    // um minuto inteiro quando a próxima leitura poderia funcionar.
    return new Map()
  }
}

function parseEffort(raw: string | undefined, key: string, fallback: Effort): Effort {
  if (raw === undefined) return fallback
  const value = raw.trim().toLowerCase()
  if ((VALID_EFFORTS as readonly string[]).includes(value)) return value as Effort
  console.warn(
    `[chatTuning] Setting "${key}" com valor inválido "${raw}". ` +
      `Esperado um de ${VALID_EFFORTS.join(', ')}. Usando "${fallback}".`
  )
  return fallback
}

function parseMaxTokens(raw: string | undefined, key: string, fallback: number): number {
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw.trim(), 10)
  if (Number.isFinite(value) && value >= MIN_MAX_TOKENS && value <= MAX_MAX_TOKENS) return value
  console.warn(
    `[chatTuning] Setting "${key}" com valor inválido "${raw}". ` +
      `Esperado inteiro entre ${MIN_MAX_TOKENS} e ${MAX_MAX_TOKENS}. Usando ${fallback}.`
  )
  return fallback
}

/** Parâmetros de geração para o modo da requisição. */
export async function getChatTuning(isPetition: boolean): Promise<ChatTuning> {
  const settings = await loadSettings()
  const mode = isPetition ? 'petition' : 'simple'
  const defaults = TUNING_DEFAULTS[mode]
  const effortKey = isPetition ? 'chat_effort_petition' : 'chat_effort_simple'
  const tokensKey = isPetition ? 'chat_max_tokens_petition' : 'chat_max_tokens_simple'

  return {
    effort: parseEffort(settings.get(effortKey), effortKey, defaults.effort),
    maxTokens: parseMaxTokens(settings.get(tokensKey), tokensKey, defaults.maxTokens),
  }
}

/** Zera o cache. Existe para os testes, que não devem depender do TTL. */
export function resetChatTuningCache(): void {
  cache = null
}
