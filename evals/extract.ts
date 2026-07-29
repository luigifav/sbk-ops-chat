/**
 * Extrai candidatos a golden set da tabela `Message` (issue #60, passo 1).
 *
 * A saída é um RASCUNHO, não o conjunto final. O script não sabe qual era a
 * resposta certa: ele só sabe quais mensagens são boas candidatas a virar caso, e
 * preenche o que dá para preencher. O passo 2 da issue, revisão humana, é
 * obrigatório, e é o que transforma o rascunho em régua.
 *
 * A seleção cobre, de propósito, as dimensões que a issue lista, porque uma
 * otimização de custo pode quebrar uma delas sem mover a média das outras:
 *
 * - mensagens aprovadas pelo operador (`feedback = 1`), que são o sinal mais
 *   próximo de "resposta certa" que existe no log;
 * - os cinco clientes de CLIENT_IDS;
 * - os temas presentes em `Message.theme`;
 * - os dois modos, petição e pergunta curta;
 * - casos em que a resposta correta é escalar. São os mais frágeis a qualquer
 *   relaxamento de recuperação: afrouxar o RAG faz o modelo inventar em vez de
 *   escalar, e isso não aparece na taxa de acerto geral.
 *
 * Uso:
 *   npm run eval:extract                      # grava evals/golden-set.draft.json
 *   npm run eval:extract -- --target 60
 *   npm run eval:extract -- --out outro.json
 */

import { writeFileSync, existsSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { CLIENT_IDS } from '../lib/categories'
import { EVAL_OPERATOR_NAME } from '../lib/evalMode'
import type { GoldenCase, GoldenSet } from './types'

const prisma = new PrismaClient()

/** Mesmo critério da rota de chat: acima disso a mensagem é tratada como petição. */
const PETITION_CHAR_THRESHOLD = 400

/** Frases que o prompt manda usar quando a informação não está na documentação. */
const ESCALATION_MARKERS = [
  'não encontrei',
  'escale para o suporte',
  'escalar para o suporte',
  'entre em contato com o suporte',
]

function looksLikeEscalation(answer: string): boolean {
  const a = answer.toLowerCase()
  return ESCALATION_MARKERS.some((m) => a.includes(m))
}

interface Row {
  id: string
  question: string
  answer: string
  theme: string | null
  detectedClient: string | null
  feedback: number | null
  ragFallback: boolean
}

/**
 * Escolhe até `target` candidatos com cobertura das dimensões acima.
 *
 * A estratégia é por cotas, e não "os N melhores": pegar só as mensagens com
 * feedback positivo produziria um conjunto enviesado para o que já funciona, que é
 * exatamente onde uma regressão não aparece.
 */
function select(rows: Row[], target: number): Row[] {
  const chosen = new Map<string, Row>()
  const take = (r: Row) => {
    if (chosen.size < target) chosen.set(r.id, r)
  }

  const isPetition = (r: Row) => r.question.length > PETITION_CHAR_THRESHOLD
  const remaining = () => rows.filter((r) => !chosen.has(r.id))

  // 1. Casos de escalada primeiro, porque são os mais frágeis e os mais raros.
  const escalation = remaining().filter((r) => looksLikeEscalation(r.answer))
  escalation.slice(0, Math.ceil(target * 0.2)).forEach(take)

  // 2. Petições, com cota mínima, por cliente.
  for (const client of CLIENT_IDS) {
    remaining()
      .filter((r) => isPetition(r) && r.detectedClient === client)
      .slice(0, 2)
      .forEach(take)
  }

  // 3. Perguntas curtas aprovadas, por cliente.
  for (const client of CLIENT_IDS) {
    remaining()
      .filter((r) => !isPetition(r) && r.detectedClient === client && r.feedback === 1)
      .slice(0, 3)
      .forEach(take)
  }

  // 4. Um por tema ainda não coberto.
  const themesCovered = new Set(Array.from(chosen.values()).map((r) => r.theme))
  for (const r of remaining()) {
    if (!themesCovered.has(r.theme)) {
      themesCovered.add(r.theme)
      take(r)
    }
  }

  // 5. Completa com o que sobrou, priorizando aprovadas e sem fallback (mais
  //    chance de a resposta gravada estar de fato correta).
  remaining()
    .sort((a, b) => {
      const score = (r: Row) => (r.feedback === 1 ? 2 : 0) + (r.ragFallback ? 0 : 1)
      return score(b) - score(a)
    })
    .forEach(take)

  return Array.from(chosen.values())
}

function toCase(r: Row): GoldenCase {
  const petition = r.question.length > PETITION_CHAR_THRESHOLD
  const escalation = looksLikeEscalation(r.answer)

  const base: GoldenCase = {
    id: `m_${r.id.slice(-8)}`,
    track: petition ? 'petition' : 'open',
    question: r.question,
    client: r.detectedClient,
    notes:
      `REVISAR. Origem: Message ${r.id}` +
      `${r.theme ? `, tema "${r.theme}"` : ''}` +
      `${r.feedback === 1 ? ', aprovada pelo operador' : ''}` +
      `${r.ragFallback ? ', respondida via fallback de documentos' : ''}` +
      `${escalation ? ', a resposta gravada escalou' : ''}`,
  }

  if (escalation) base.expectEscalation = true

  if (petition) {
    // Deixado VAZIO de propósito. Preencher automaticamente com os campos que a
    // resposta gravada produziu transformaria a saída de então em verdade, e o
    // conjunto passaria a aprovar exatamente o que o modelo já faz, inclusive os
    // erros. Quem revisa preenche olhando a petição.
    base.expectedFields = {}
  } else {
    base.criteria = []
  }

  return base
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }

  const target = Number.parseInt(flag('target') ?? '50', 10)
  if (!Number.isFinite(target) || target <= 0) {
    console.error('erro: --target precisa ser inteiro positivo')
    process.exit(1)
  }
  const out = flag('out') ?? 'evals/golden-set.draft.json'

  if (existsSync(out)) {
    console.error(
      `erro: "${out}" já existe. Renomeie ou apague antes, para não perder revisão feita à mão.`
    )
    process.exit(1)
  }

  const rows = await prisma.message.findMany({
    where: {
      // Mensagens do próprio harness nunca entram no conjunto: seria o eval se
      // avaliando e o conjunto crescendo a cada rodada.
      operatorName: { not: EVAL_OPERATOR_NAME },
      // Uma resposta que não chegou ao fim não serve de caso: o texto está
      // cortado e não representa o que o modelo produz quando funciona.
      stopReason: { notIn: ['timeout', 'error', 'max_tokens'] },
      // Feedback negativo indica resposta ruim e não serve de referência. O OR
      // com null é obrigatório, não defensivo: em SQL, `feedback <> -1` avalia
      // como NULL quando a coluna é NULL, e a linha é descartada. Sem isso o
      // filtro derrubava TODA mensagem sem feedback, que é a maioria, e o
      // conjunto sairia enviesado para o que já foi avaliado pelo operador,
      // justamente o viés que a seleção por cotas existe para evitar.
      OR: [{ feedback: null }, { feedback: { not: -1 } }],
    },
    orderBy: { createdAt: 'desc' },
    // Teto de leitura: o log pode ser grande e a seleção só precisa de material
    // recente suficiente para preencher as cotas.
    take: 2_000,
    select: {
      id: true,
      question: true,
      answer: true,
      theme: true,
      detectedClient: true,
      feedback: true,
      ragFallback: true,
    },
  })

  if (rows.length === 0) {
    console.error('erro: nenhuma mensagem elegível na tabela Message. Sem log, não há de onde extrair.')
    process.exit(1)
  }

  const selected = select(rows, target)
  const set: GoldenSet = { version: 1, cases: selected.map(toCase) }
  writeFileSync(out, JSON.stringify(set, null, 2) + '\n')

  const petitions = set.cases.filter((c) => c.track === 'petition').length
  const escalations = set.cases.filter((c) => c.expectEscalation).length
  const clients = new Set(set.cases.map((c) => c.client ?? 'nenhum'))

  console.log(`
Rascunho gravado em ${out}

  candidatos lidos     ${rows.length}
  casos selecionados   ${set.cases.length} (alvo ${target})
  petições             ${petitions}
  perguntas abertas    ${set.cases.length - petitions}
  casos de escalada    ${escalations}
  clientes cobertos    ${Array.from(clients).join(', ')}

PRÓXIMO PASSO, obrigatório: revisar à mão e salvar como evals/golden-set.json.

  - nas petições, preencher expectedFields olhando a petição, não a resposta que
    o modelo deu. Elas vêm vazias justamente para não canonizar o erro atual.
  - nas perguntas abertas, escrever os criteria concretos de cada caso.
  - conferir o expectEscalation que foi inferido do texto da resposta.
  - apagar os casos que não valem, e o campo notes quando não servir mais.
`)
  if (set.cases.length < 40) {
    console.log(
      `aviso: ${set.cases.length} casos ficam abaixo dos 40 que a issue #60 pede. ` +
        `Com log pequeno, complete o conjunto à mão.\n`
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
