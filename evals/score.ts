/**
 * Correção dos casos do harness (issue #60), em duas trilhas.
 *
 * A trilha de petição é determinística: a resposta tem campos definidos, então a
 * nota é comparação campo a campo, sem modelo nenhum no meio. É a trilha que
 * importa mais, porque a classificação é a tarefa de maior valor do produto e é a
 * que uma redução de `effort` degrada primeiro.
 *
 * A trilha aberta usa um juiz com rubrica explícita, porque não há resposta única.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { GoldenCase } from './types'

/**
 * Modelo do juiz. PINADO DE PROPÓSITO, e não lido de CHAT_MODEL.
 *
 * Se o juiz acompanhasse o modelo avaliado, trocar o modelo do chat moveria a
 * régua junto e a comparação antes/depois não mediria a mudança, mediria a
 * diferença entre dois juízes. Ao trocar o modelo do chat, este valor deve ficar
 * onde está.
 */
export const JUDGE_MODEL = 'claude-sonnet-4-6'

/** Teto de saída do juiz. O veredicto é um JSON curto. */
const JUDGE_MAX_TOKENS = 700

/** Normaliza para comparação: sem acento, minúsculo, espaços colapsados. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    // Faixa de diacríticos combinantes, escrita como escape para não depender de
    // como o arquivo foi salvo.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // O trim vem ANTES de tirar a pontuação final: com o espaço ainda no fim, a
    // âncora `$` não casava e "causa raiz. " normalizava para "causa raiz.", que
    // então não batia com "causa raiz".
    .trim()
    .replace(/[.,;:!?]+$/, '')
    .trim()
}

/**
 * Extrai os campos de uma resposta de classificação.
 *
 * Casa as duas formas que os prompts produzem: `- **CAMPO:** valor` (formato
 * Bradesco e a seção Classificação do formato genérico) e `**CAMPO:** valor` sem
 * marcador de lista. A chave é normalizada para que a comparação não dependa de
 * o modelo ter escrito "Causa raiz" ou "CAUSA RAIZ".
 */
export function parseFields(answer: string): Map<string, string> {
  const fields = new Map<string, string>()
  const re = /^\s*(?:[-*]\s*)?\*\*(.+?):?\*\*:?\s*(.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(answer)) !== null) {
    const key = normalize(m[1])
    const value = m[2].trim()
    // Primeira ocorrência ganha: se o modelo repetir um campo, o de cima é o que
    // ele apresentou como resposta.
    if (!fields.has(key)) fields.set(key, value)
  }
  return fields
}

/** Primeiro código numérico do valor, quando houver. */
function leadingCode(value: string): string | null {
  const m = value.match(/\d{2,}/)
  return m ? m[0] : null
}

/**
 * Compara um campo. Quando o esperado é um código numérico, compara só o código e
 * ignora a descrição: o código é o que precisa sair certo, a descrição é prosa do
 * modelo e varia sem estar errada. Fora disso, compara o texto normalizado, com
 * tolerância a o valor esperado aparecer contido no obtido (o modelo costuma
 * anexar uma justificativa curta ao valor).
 */
export function fieldMatches(expected: string, got: string): boolean {
  const expectedCode = leadingCode(expected)
  if (expectedCode !== null && normalize(expected) === normalize(expectedCode)) {
    return leadingCode(got) === expectedCode
  }
  const e = normalize(expected)
  const g = normalize(got)
  if (e === g) return true
  return g.includes(e)
}

export interface DeterministicVerdict {
  passed: boolean
  score: number
  reason: string
  fieldErrors: Array<{ field: string; expected: string; got: string | null }>
}

/** Corrige um caso da trilha de petição. */
export function scorePetition(c: GoldenCase, answer: string): DeterministicVerdict {
  const expected = c.expectedFields ?? {}
  const names = Object.keys(expected)
  if (names.length === 0) {
    return {
      passed: false,
      score: 0,
      reason: 'caso de petição sem expectedFields, nada a comparar',
      fieldErrors: [],
    }
  }

  const got = parseFields(answer)
  const fieldErrors: DeterministicVerdict['fieldErrors'] = []
  let hits = 0

  for (const name of names) {
    const actual = got.get(normalize(name)) ?? null
    if (actual !== null && fieldMatches(expected[name], actual)) {
      hits++
    } else {
      fieldErrors.push({ field: name, expected: expected[name], got: actual })
    }
  }

  const score = hits / names.length
  return {
    passed: hits === names.length,
    score,
    reason:
      hits === names.length
        ? `${hits}/${names.length} campos corretos`
        : `${hits}/${names.length} campos corretos, erraram: ${fieldErrors.map((f) => f.field).join(', ')}`,
    fieldErrors,
  }
}

export interface JudgeVerdict {
  passed: boolean
  score: number
  reason: string
  /** Tokens do próprio juiz, para o custo dele não se misturar ao do chat. */
  inputTokens: number
  outputTokens: number
}

/**
 * Extrai o objeto JSON do veredicto. O juiz é instruído a responder só o JSON, mas
 * modelos anexam cerca ou uma frase antes com alguma frequência, então o parser
 * recorta do primeiro `{` ao último `}`. Falha de parse é erro explícito, nunca um
 * caso considerado aprovado por omissão: um juiz que não respondeu não é um
 * "passou".
 */
export function parseJudgeJson(raw: string): {
  aprovado: boolean
  nota: number
  motivo: string
} {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`juiz não devolveu JSON: ${raw.slice(0, 200)}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>

  const aprovado = parsed.aprovado
  const nota = parsed.nota
  const motivo = parsed.motivo
  if (typeof aprovado !== 'boolean') {
    throw new Error(`campo "aprovado" ausente ou não booleano: ${JSON.stringify(parsed)}`)
  }
  if (typeof nota !== 'number' || !Number.isFinite(nota) || nota < 0 || nota > 1) {
    throw new Error(`campo "nota" fora de 0..1: ${JSON.stringify(parsed)}`)
  }
  return {
    aprovado,
    nota,
    motivo: typeof motivo === 'string' ? motivo : '',
  }
}

/** Monta o prompt do juiz. Exportado para poder ser inspecionado e testado. */
export function judgePrompt(c: GoldenCase, answer: string): string {
  const criterios = (c.criteria ?? []).map((x, i) => `${i + 1}. ${x}`).join('\n')
  return `Você avalia respostas de um assistente operacional interno de uma empresa de Legal Operations. O assistente responde dúvidas de operadores usando exclusivamente documentação interna recuperada por busca.

Avalie a RESPOSTA abaixo contra a rubrica. Seja rigoroso: na dúvida, reprove.

PERGUNTA DO OPERADOR:
${c.question}

CLIENTE ESPERADO: ${c.client ?? 'nenhum cliente específico'}

RESPOSTA DO ASSISTENTE:
${answer}

RUBRICA OBRIGATÓRIA, todos os itens precisam ser satisfeitos:
a) A resposta se apoia apenas na documentação, sem inventar prazo, nome de sistema, fluxo ou regra.
b) A resposta trata do cliente esperado, quando há um.
c) A resposta NÃO mistura informação de clientes diferentes.
d) ${
    c.expectEscalation
      ? 'A resposta correta aqui é dizer que não encontrou a informação e orientar a escalar para o suporte SBK. Se ela responder com conteúdo específico em vez de escalar, REPROVE.'
      : 'A resposta de fato responde à pergunta, em vez de escalar sem necessidade.'
  }
${criterios ? `\nCRITÉRIOS ESPECÍFICOS DESTE CASO, também obrigatórios:\n${criterios}` : ''}

Responda APENAS com um objeto JSON, sem cerca de código e sem texto antes ou depois:
{"aprovado": true ou false, "nota": número de 0 a 1, "motivo": "uma frase curta"}`
}

/** Corrige um caso da trilha aberta com o juiz. */
export async function scoreOpen(
  anthropic: Anthropic,
  c: GoldenCase,
  answer: string
): Promise<JudgeVerdict> {
  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    // O juiz não usa extended thinking: a rubrica é curta e o veredicto é um JSON.
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: judgePrompt(c, answer) }],
  })

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')

  const verdict = parseJudgeJson(text)
  return {
    passed: verdict.aprovado,
    score: verdict.nota,
    reason: verdict.motivo,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  }
}
