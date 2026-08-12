/**
 * Classificação de tema das perguntas (issue #70).
 *
 * O tema alimenta exatamente um consumidor de produto: o gráfico de distribuição
 * do dashboard, mais o `topTheme` e a coluna do CSV que saem do mesmo lugar. Ele
 * NUNCA entra no prompt do chat, então errar um tema não pode degradar nenhuma
 * resposta a operador. Isso é o que torna esta troca segura.
 *
 * O que havia antes: uma chamada ao Haiku 4.5 por mensagem, fire-and-forget, com
 * um prompt de cerca de 940 caracteres reconstruído a cada chamada e sem cache
 * nenhum. Pelos preços de lib/pricing.ts (1,00 USD/1M de entrada, 5,00 de saída)
 * isso dá aproximadamente 0,00031 USD por mensagem: cerca de 2,80 USD por mês a
 * 300 mensagens por dia. Pequeno em valor absoluto, mas é 100% do custo de um
 * item que só desenha um gráfico, e a chamada é fire-and-forget disparada depois
 * do `controller.close()` numa função serverless, ou seja, sem garantia nenhuma
 * de que chega a completar.
 *
 * O classificador por palavra-chave abaixo roda em microssegundos, é síncrono,
 * determinístico, custa zero e é auditável: dá para conferir a regra que
 * classificou qualquer mensagem. Os rótulos são exatamente os cinco que o prompt
 * do Haiku já enumerava, então a série histórica do gráfico continua comparável.
 *
 * COMO VALIDAR SEM GASTAR NADA: as mensagens já classificadas pelo Haiku estão
 * na tabela `Message`. Comparar `classifyThemeHeuristic(question)` contra
 * `Message.theme` nessas linhas mede a concordância sem uma única chamada de
 * API. Se a concordância for baixa demais para o gráfico ser útil, a chave
 * `theme_classifier = llm` em `Setting` restaura o comportamento anterior sem
 * deploy — o caminho do Haiku continua aqui, inteiro, por isso.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { THEME_MODEL } from '@/lib/pricing'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

/** Os cinco rótulos fixos, iguais aos que o prompt do Haiku enumerava. */
export const THEMES = {
  PRAZO: 'Prazo e SLA',
  SISTEMA: 'Sistema e acesso',
  PROCESSO: 'Processo operacional',
  CLIENTE: 'Dúvida sobre cliente',
  OUTROS: 'Outros',
} as const

/**
 * Regras em ordem de precedência. A primeira que casar decide.
 *
 * A ordem importa e não é arbitrária. "Qual o prazo de resposta do Bradesco?"
 * cita um cliente e pergunta um prazo; o tema útil ali é o prazo, porque
 * "Dúvida sobre cliente" agruparia metade das perguntas do produto (todo fluxo
 * da SBK é por cliente) e o gráfico perderia o poder de separar. Por isso o
 * rótulo de cliente vem por último entre os específicos: ele é o que sobra
 * quando a pergunta cita um cliente e nada mais caracteriza o assunto.
 *
 * Acentos são removidos antes da comparação, então basta a forma sem acento nos
 * padrões. Os limites \b evitam que "prazo" case dentro de outra palavra.
 */
const RULES: ReadonlyArray<{ theme: string; pattern: RegExp }> = [
  {
    theme: THEMES.PRAZO,
    pattern:
      /\b(prazo|prazos|sla|slas|vencimento|vencer|venc[ei]|deadline|data limite|prescri\w*|tempestiv\w*|urgen\w*|atras\w*|contagem de prazo|dias uteis)\b/,
  },
  {
    theme: THEMES.SISTEMA,
    pattern:
      /\b(sistema|sistemas|login|senha|acesso|acessar|logar|usuario|credencia\w*|permissao|permissoes|portal|plataforma|ferramenta|bloquead\w*|token|autentica\w*|vpn|conta bloqueada|nao consigo entrar|fora do ar|instabilidade)\b/,
  },
  {
    theme: THEMES.PROCESSO,
    pattern:
      /\b(como (faco|fazer|proceder|cadastrar|lancar|registrar|classificar)|procedimento|processo interno|fluxo|passo a passo|rotina|manual|checklist|protocolo|workflow|etapa|cadastr\w*|classific\w*|peticao|peticoes|inicial|oficio|oficios|audiencia|distribui\w*)\b/,
  },
  {
    theme: THEMES.CLIENTE,
    pattern: /\b(bradesco|agibank|eagle|zurich|cwt)\b/,
  },
]

/** Remove acentos e normaliza para caixa baixa, para as regras ficarem simples. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Classificador por palavra-chave. Puro, síncrono e sem I/O: dá para testar e
 * para rodar sobre o histórico da tabela `Message` sem tocar em nenhuma API.
 */
export function classifyThemeHeuristic(question: string): string {
  // O mesmo recorte de 300 caracteres que o prompt do Haiku usava, para que a
  // comparação entre os dois classificadores seja sobre a mesma entrada.
  const text = normalize(question.slice(0, 300))
  for (const { theme, pattern } of RULES) {
    if (pattern.test(text)) return theme
  }
  return THEMES.OUTROS
}

/** Caminho antigo, mantido atrás de `theme_classifier = llm` em `Setting`. */
export async function classifyThemeWithModel(question: string): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: THEME_MODEL,
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: `Você é um classificador de perguntas de operadores de Legal Operations.

Temas fixos disponíveis:
- ${THEMES.PRAZO}: perguntas sobre prazos, SLAs, datas limite
- ${THEMES.SISTEMA}: perguntas sobre sistemas, logins, acessos, ferramentas
- ${THEMES.PROCESSO}: perguntas sobre como executar processos, procedimentos
- ${THEMES.CLIENTE}: perguntas específicas sobre Bradesco, Agibank, Eagle, Zurich ou outros clientes
- ${THEMES.OUTROS}: não se encaixa nos anteriores

Se identificar um padrão recorrente diferente dos temas acima, nomeie o tema livremente em até 3 palavras.

Pergunta: "${question.slice(0, 300)}"

Responda APENAS com o nome do tema, sem explicação, sem pontuação.`,
        },
      ],
    })
    return response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : THEMES.OUTROS
  } catch {
    return THEMES.OUTROS
  }
}

// Cache em memória do modo de classificação, no mesmo padrão de lib/chatTuning.ts:
// uma leitura de Setting por minuto por instância, em vez de uma por mensagem.
const MODE_TTL_MS = 60_000
let modeCache: { at: number; value: 'heuristic' | 'llm' } | null = null

async function resolveMode(): Promise<'heuristic' | 'llm'> {
  const now = Date.now()
  if (modeCache && now - modeCache.at < MODE_TTL_MS) return modeCache.value

  let value: 'heuristic' | 'llm' = 'heuristic'
  try {
    const row = await prisma.setting.findUnique({
      where: { key: 'theme_classifier' },
      select: { value: true },
    })
    const raw = row?.value?.trim().toLowerCase()
    if (raw === 'llm') value = 'llm'
    else if (raw !== undefined && raw !== 'heuristic') {
      console.warn(
        `[theme] Setting "theme_classifier" com valor inválido "${row?.value}". ` +
          'Esperado "heuristic" ou "llm". Usando "heuristic".'
      )
    }
    modeCache = { at: now, value }
  } catch (err) {
    // Não grava no cache: uma falha transitória não deve fixar o modo por um
    // minuto inteiro quando a próxima leitura poderia funcionar.
    console.warn('[theme] Falha ao ler Setting, usando heurística:', err)
  }
  return value
}

/** Zera o cache do modo. Existe para os testes, que não devem depender do TTL. */
export function resetThemeModeCache(): void {
  modeCache = null
}

/**
 * Classifica pelo modo em vigor. Fora do modo `llm` não faz I/O de API nenhum.
 */
export async function classifyTheme(question: string): Promise<string> {
  const mode = await resolveMode()
  return mode === 'llm'
    ? classifyThemeWithModel(question)
    : classifyThemeHeuristic(question)
}

/**
 * Classifica e grava o tema da mensagem.
 *
 * No modo heurístico não há chamada de API, então a rota chama esta função com
 * `await` dentro do mesmo caminho da gravação da mensagem: o fire-and-forget
 * anterior existia só para não somar a latência do Haiku à resposta, e em
 * serverless ele não tinha garantia de completar depois do fim do stream. A
 * falha do update continua sendo tratada aqui: uma mensagem que ficasse sem tema
 * antes era reclassificada pelo backfill do dashboard em cada carregamento,
 * indefinidamente. O backfill foi removido (issue #70), então a falha precisa
 * aparecer no log em vez de virar uma reclassificação silenciosa. Sem tema, a
 * mensagem simplesmente conta como "Outros" na distribuição.
 */
export async function classifyAndSaveTheme(messageId: string, question: string): Promise<void> {
  const theme = await classifyTheme(question)
  try {
    await prisma.message.update({
      where: { id: messageId },
      data: { theme },
    })
  } catch (err) {
    console.warn('[theme] Falha ao gravar tema da mensagem:', JSON.stringify({
      messageId,
      theme,
      message: err instanceof Error ? err.message : String(err),
    }))
  }
}
