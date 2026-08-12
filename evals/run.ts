/**
 * Runner do harness de avaliação (issue #60, passos 3 a 5).
 *
 * Roda cada caso do golden set contra a ROTA DE CHAT DE VERDADE, por HTTP, e não
 * contra uma reimplementação do pipeline. Isso é o ponto: o que se quer medir é o
 * efeito de mudanças em RAG, cache, `effort` e modelo, e qualquer atalho que pule
 * a rota deixaria de fora exatamente a parte que muda.
 *
 * Como o custo por caso é lido: o runner gera um `messageId` e o envia no corpo da
 * requisição, campo que a rota já aceita e usa como id da linha em `Message`.
 * Depois do stream terminar, o runner lê essa linha e pega tokens, fallback,
 * ragTopScore, stopReason e latência medidos pela própria rota. Sem isso, o custo
 * teria de ser estimado por fora, e estimativa é o que este harness existe para
 * substituir.
 *
 * Uso:
 *   npm run eval
 *   npm run eval -- --set evals/golden-set.json --out evals/results
 *   npm run eval -- --baseline evals/results/2026-07-29T12-00-00.json
 *   npm run eval -- --only p_0001,o_0002        # subconjunto, para iterar rápido
 *
 * Ambiente:
 *   EVAL_BASE_URL     padrão http://localhost:3000
 *   ACCESS_PASSWORD   necessário, o runner assina o cookie de operador com ele
 *   AUTH_SECRET       necessário
 *   ANTHROPIC_API_KEY necessário para o juiz da trilha aberta
 *   DATABASE_URL      necessário para ler os tokens de cada caso
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'
import { generateToken } from '../lib/auth'
import { EVAL_OPERATOR_NAME } from '../lib/evalMode'
import { CHAT_MODEL, costUsd, pricingFor } from '../lib/pricing'
import { JUDGE_MODEL, scoreOpen, scorePetition } from './score'
import type { CaseResult, GoldenSet, RunSummary, Track } from './types'

const prisma = new PrismaClient()

/** Espera entre casos, para não empilhar requisições na instância sob teste. */
const DELAY_MS = 400

/** Teto de espera por caso. A rota já aborta o stream dela em 60 s. */
const CASE_TIMEOUT_MS = 120_000

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`erro: variável de ambiente ${name} é obrigatória para rodar o eval.`)
    process.exit(1)
  }
  return v
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * id de linha aceito pela rota: alfanumérico com hífen e underscore, até 64
 * (SESSION_ID_REGEX em app/api/chat/route.ts).
 *
 * O `runStamp` NÃO é decoração. Sem ele o id era determinístico por caso
 * (`eval-3-peticao_bradesco`), e o efeito aparecia só na segunda rodada: o
 * `prisma.message.create` da rota colidia na chave primária, o catch vazio do
 * caminho de log engolia o erro em silêncio, e a leitura de tokens logo abaixo
 * encontrava a linha da rodada ANTERIOR. Custo, tokens, ragFallback e latência
 * do relatório passavam a ser os da rodada velha.
 *
 * O modo de falha era o pior possível para o uso a que este harness se destina:
 * rodar um baseline com `effort: high`, depois rodar com `low` e comparar. A
 * qualidade mudava (ela vem da resposta, que é nova) e o custo aparecia
 * IDÊNTICO, sugerindo que baixar o effort não economiza nada. A conclusão errada
 * saía com cara de medição.
 */
function makeMessageId(caseId: string, index: number, runStamp: string): string {
  const safe = caseId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 24)
  const id = `eval-${runStamp}-${index}-${safe}`
  // Cinto de segurança: a rota descarta silenciosamente um messageId que não
  // case com o regex, e aí a linha ganha id gerado pelo banco e o harness não
  // acha os tokens dela. Truncar aqui é preferível a perder a medição.
  return id.slice(0, 64)
}

async function callChat(
  baseUrl: string,
  cookie: string,
  question: string,
  messageId: string,
  sessionId: string
): Promise<{ answer: string; httpStatus: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        messages: [{ role: 'user', content: question }],
        sessionId,
        messageId,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 429) {
        throw new Error(
          `429 do rate limit. Suba CHAT_HOURLY_LIMIT na instância que roda o eval ` +
            `(um conjunto de 40+ casos estoura o padrão de 60 por hora). Corpo: ${body.slice(0, 200)}`
        )
      }
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`)
    }

    // A rota devolve texto puro em stream. Consumir tudo equivale a esperar o fim.
    const answer = await res.text()
    return { answer, httpStatus: res.status }
  } finally {
    clearTimeout(timer)
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }

  const setPath = flag('set') ?? 'evals/golden-set.json'
  const outDir = flag('out') ?? 'evals/results'
  const baselinePath = flag('baseline')
  const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean)

  // Compara duas rodadas já gravadas, sem rodar nada. Serve para revisitar uma
  // decisão depois, sem pagar a rodada de novo, e para conferir o diff de duas
  // rodadas antigas quando alguém pergunta de onde veio um número.
  const compare = flag('compare')
  if (compare) {
    const second = argv[argv.indexOf('--compare') + 2]
    if (!second || second.startsWith('--')) {
      console.error('erro: --compare precisa de dois arquivos: --compare ANTES DEPOIS')
      process.exit(1)
    }
    for (const p of [compare, second]) {
      if (!existsSync(p)) {
        console.error(`erro: arquivo de resultado "${p}" não encontrado.`)
        process.exit(1)
      }
    }
    printDiff(
      JSON.parse(readFileSync(compare, 'utf-8')) as RunSummary,
      JSON.parse(readFileSync(second, 'utf-8')) as RunSummary
    )
    console.log('')
    return
  }

  if (!existsSync(setPath)) {
    console.error(
      `erro: golden set não encontrado em "${setPath}".\n` +
        `Gere um rascunho com "npm run eval:extract", revise à mão e salve como ${setPath}.\n` +
        `Ver evals/README.md.`
    )
    process.exit(1)
  }

  const set = JSON.parse(readFileSync(setPath, 'utf-8')) as GoldenSet
  if (set.version !== 1) {
    console.error(`erro: golden set com versão ${set.version}, este runner entende a 1.`)
    process.exit(1)
  }

  let cases = set.cases
  if (only) cases = cases.filter((c) => only.includes(c.id))
  if (cases.length === 0) {
    console.error('erro: nenhum caso a rodar.')
    process.exit(1)
  }

  // Casos mal preenchidos são erro de configuração, e falhar agora é melhor que
  // gastar uma rodada inteira de API para descobrir no relatório.
  const broken = cases.filter(
    (c) =>
      (c.track === 'petition' && Object.keys(c.expectedFields ?? {}).length === 0) ||
      (c.track === 'open' && (c.criteria ?? []).length === 0)
  )
  if (broken.length > 0) {
    const shown = broken.slice(0, 8).map((c) => c.id).join(', ')
    const rest = broken.length > 8 ? ` e outros ${broken.length - 8}` : ''
    console.error(
      `erro: ${broken.length} de ${cases.length} caso(s) sem critério de correção preenchido: ` +
        `${shown}${rest}.\n` +
        `Petição precisa de expectedFields, pergunta aberta precisa de criteria. ` +
        `O extrator deixa esses campos vazios de propósito, para revisão humana: ` +
        `preencher automaticamente com a saída atual do modelo canonizaria o erro dela.`
    )
    process.exit(1)
  }

  const baseUrl = (process.env.EVAL_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const accessPassword = requireEnv('ACCESS_PASSWORD')
  const authSecret = requireEnv('AUTH_SECRET')
  requireEnv('ANTHROPIC_API_KEY')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  // Autentica pelo caminho normal da rota. `sbk_operator_name` é o fallback usado
  // quando não há `sbk_operator_id`, então o harness se identifica por ele e não
  // precisa existir como Operator no banco. Consequência a ter em mente: sem
  // operatorId, o escopo de cliente vem só do texto da pergunta, então um caso que
  // dependa de operador restrito a um cliente precisa mencionar o cliente no texto.
  const authToken = await generateToken(accessPassword, authSecret)
  const cookie = `sbk_auth_token=${authToken}; sbk_operator_name=${EVAL_OPERATOR_NAME}`

  // Configuração em vigor, para o diff dizer o que mudou entre duas rodadas.
  let tuning: Record<string, string> | null = null
  try {
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'chat_' } } })
    tuning = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch {
    // Não fatal: a rodada vale mesmo sem saber os Settings.
  }

  const startedAt = new Date()
  // Carimbo da rodada, embutido no id de cada linha de Message. Compacto
  // (AAAAMMDDHHMMSS) para caber junto do id do caso nos 64 caracteres do regex
  // da rota. Duas rodadas no mesmo segundo colidiriam; na prática uma rodada de
  // 40 a 60 casos leva minutos, e o caso de uso é comparar rodadas sequenciais.
  const runStamp = startedAt.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  console.log(`\nrodando ${cases.length} caso(s) contra ${baseUrl}`)
  console.log(`modelo do chat: ${CHAT_MODEL}   juiz: ${JUDGE_MODEL}`)
  console.log(`configuração: ${tuning ? JSON.stringify(tuning) : 'não lida'}\n`)

  const results: CaseResult[] = []
  let judgeCostUsd = 0
  const judgePrices = pricingFor(JUDGE_MODEL)

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const messageId = makeMessageId(c.id, i, runStamp)
    const label = `[${i + 1}/${cases.length}] ${c.id} (${c.track})`

    const result: CaseResult = {
      id: c.id,
      track: c.track,
      passed: null,
      score: null,
      reason: '',
      answer: '',
      responseTimeMs: 0,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      cacheCreation1hTokens: null,
      ragFallback: null,
      ragTopScore: null,
      stopReason: null,
      costUsd: null,
    }

    try {
      const { answer } = await callChat(baseUrl, cookie, c.question, messageId, `eval-${i}`)
      result.answer = answer

      // Métricas medidas pela própria rota, lidas da linha que ela gravou.
      const row = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          responseTimeMs: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
          cacheCreation1hTokens: true,
          ragFallback: true,
          ragTopScore: true,
          stopReason: true,
          model: true,
        },
      })
      if (row) {
        result.responseTimeMs = row.responseTimeMs
        result.inputTokens = row.inputTokens
        result.outputTokens = row.outputTokens
        result.cacheReadTokens = row.cacheReadTokens
        result.cacheCreationTokens = row.cacheCreationTokens
        result.cacheCreation1hTokens = row.cacheCreation1hTokens
        result.ragFallback = row.ragFallback
        result.ragTopScore = row.ragTopScore
        result.stopReason = row.stopReason
        result.costUsd = costUsd(row, row.model)
      } else {
        // A resposta veio mas a linha não: a gravação em Message é em try/catch na
        // rota, então isso é possível. A nota ainda vale, o custo é que não.
        result.error = 'linha de Message não encontrada, custo e tokens indisponíveis'
      }

      if (c.track === 'petition') {
        const v = scorePetition(c, answer)
        result.passed = v.passed
        result.score = v.score
        result.reason = v.reason
        result.fieldErrors = v.fieldErrors
      } else {
        const v = await scoreOpen(anthropic, c, answer)
        result.passed = v.passed
        result.score = v.score
        result.reason = v.reason
        judgeCostUsd +=
          (v.inputTokens / 1_000_000) * judgePrices.input +
          (v.outputTokens / 1_000_000) * judgePrices.output
      }

      console.log(
        `${label}: ${result.passed ? 'PASS' : 'FAIL'} ` +
          `score=${result.score?.toFixed(2)} ${result.reason}`
      )
    } catch (err) {
      // `passed` fica null, não false: um caso que não rodou não é um caso que
      // reprovou, e somá-lo como reprovação esconderia problema de infraestrutura
      // atrás de uma queda de qualidade aparente.
      result.error = err instanceof Error ? err.message : String(err)
      result.reason = 'erro ao executar'
      console.log(`${label}: ERRO ${result.error}`)
    }

    results.push(result)
    if (i < cases.length - 1) await sleep(DELAY_MS)
  }

  const scored = results.filter((r) => r.passed !== null)
  const errors = results.filter((r) => r.passed === null)
  const passed = results.filter((r) => r.passed === true)

  const byTrack = {} as RunSummary['totals']['byTrack']
  for (const track of ['petition', 'open'] as Track[]) {
    const inTrack = scored.filter((r) => r.track === track)
    const okTrack = inTrack.filter((r) => r.passed === true)
    byTrack[track] = {
      cases: inTrack.length,
      passed: okTrack.length,
      passRate: inTrack.length > 0 ? okTrack.length / inTrack.length : null,
    }
  }

  const escalationIds = new Set(cases.filter((c) => c.expectEscalation).map((c) => c.id))
  const escalationResults = scored.filter((r) => escalationIds.has(r.id))

  const costs = results.map((r) => r.costUsd).filter((v): v is number => v != null)
  const outputs = results.map((r) => r.outputTokens).filter((v): v is number => v != null)
  const latencies = results.map((r) => r.responseTimeMs).filter((v) => v > 0)
  const fallbacks = results.map((r) => r.ragFallback).filter((v): v is boolean => v != null)

  const summary: RunSummary = {
    startedAt: startedAt.toISOString(),
    config: { baseUrl, chatModel: CHAT_MODEL, judgeModel: JUDGE_MODEL, tuning },
    totals: {
      cases: results.length,
      scored: scored.length,
      errors: errors.length,
      passed: passed.length,
      passRate: scored.length > 0 ? passed.length / scored.length : null,
      byTrack,
      escalationCases: escalationResults.length,
      escalationPassed: escalationResults.filter((r) => r.passed === true).length,
      avgCostUsd: mean(costs),
      totalCostUsd: costs.reduce((a, b) => a + b, 0),
      judgeCostUsd,
      fallbackRate:
        fallbacks.length > 0 ? fallbacks.filter(Boolean).length / fallbacks.length : null,
      avgOutputTokens: mean(outputs),
      avgResponseMs: mean(latencies),
      p95ResponseMs: percentile(latencies, 95),
    },
    results,
  }

  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const outPath = join(outDir, `${stamp}.json`)
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')

  const t = summary.totals
  const pct = (v: number | null) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`)
  console.log(`
resultado
  casos                ${t.cases}  (com nota ${t.scored}, com erro ${t.errors})
  acerto geral         ${pct(t.passRate)}  (${t.passed}/${t.scored})
  acerto petição       ${pct(t.byTrack.petition.passRate)}  (${t.byTrack.petition.passed}/${t.byTrack.petition.cases})
  acerto aberta        ${pct(t.byTrack.open.passRate)}  (${t.byTrack.open.passed}/${t.byTrack.open.cases})
  casos de escalada    ${t.escalationPassed}/${t.escalationCases}
  custo por mensagem   ${t.avgCostUsd == null ? '-' : `$${t.avgCostUsd.toFixed(5)}`}
  custo total do chat  $${t.totalCostUsd.toFixed(4)}
  custo do juiz        $${t.judgeCostUsd.toFixed(4)}
  taxa de fallback     ${pct(t.fallbackRate)}
  tokens de saída      ${t.avgOutputTokens == null ? '-' : Math.round(t.avgOutputTokens)}
  latência média       ${t.avgResponseMs == null ? '-' : `${Math.round(t.avgResponseMs)} ms`}
  latência p95         ${t.p95ResponseMs == null ? '-' : `${Math.round(t.p95ResponseMs)} ms`}

gravado em ${outPath}`)

  if (t.errors > 0) {
    console.log(`
aviso: ${t.errors} caso(s) não rodaram e ficaram fora da taxa de acerto. Eles contam
como erro de infraestrutura, não como reprovação, para não parecerem queda de
qualidade. Resolva antes de comparar com um baseline.`)
  }

  if (baselinePath) {
    if (!existsSync(baselinePath)) {
      console.error(`\nerro: baseline "${baselinePath}" não encontrado.`)
      process.exit(1)
    }
    const base = JSON.parse(readFileSync(baselinePath, 'utf-8')) as RunSummary
    printDiff(base, summary)
  }

  console.log('')
}

function printDiff(base: RunSummary, now: RunSummary) {
  const fmtPct = (v: number | null) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`)
  const fmtUsd = (v: number | null) => (v == null ? '-' : `$${v.toFixed(5)}`)
  const fmtNum = (v: number | null) => (v == null ? '-' : String(Math.round(v)))

  const delta = (a: number | null, b: number | null, better: 'up' | 'down') => {
    if (a == null || b == null) return '-'
    const diff = b - a
    if (Math.abs(diff) < 1e-9) return 'igual'
    const improved = better === 'up' ? diff > 0 : diff < 0
    const pctChange = a !== 0 ? ` (${diff > 0 ? '+' : ''}${((diff / Math.abs(a)) * 100).toFixed(1)}%)` : ''
    return `${diff > 0 ? '+' : ''}${diff.toFixed(4)}${pctChange} ${improved ? 'melhor' : 'pior'}`
  }

  console.log(`
diff contra ${base.startedAt}
  configuração antes: ${base.config.tuning ? JSON.stringify(base.config.tuning) : 'não registrada'}
  configuração agora: ${now.config.tuning ? JSON.stringify(now.config.tuning) : 'não registrada'}
  modelo antes: ${base.config.chatModel}   agora: ${now.config.chatModel}

  métrica                antes        agora        variação
  acerto geral           ${fmtPct(base.totals.passRate).padEnd(12)} ${fmtPct(now.totals.passRate).padEnd(12)} ${delta(base.totals.passRate, now.totals.passRate, 'up')}
  acerto petição         ${fmtPct(base.totals.byTrack.petition.passRate).padEnd(12)} ${fmtPct(now.totals.byTrack.petition.passRate).padEnd(12)} ${delta(base.totals.byTrack.petition.passRate, now.totals.byTrack.petition.passRate, 'up')}
  acerto aberta          ${fmtPct(base.totals.byTrack.open.passRate).padEnd(12)} ${fmtPct(now.totals.byTrack.open.passRate).padEnd(12)} ${delta(base.totals.byTrack.open.passRate, now.totals.byTrack.open.passRate, 'up')}
  custo por mensagem     ${fmtUsd(base.totals.avgCostUsd).padEnd(12)} ${fmtUsd(now.totals.avgCostUsd).padEnd(12)} ${delta(base.totals.avgCostUsd, now.totals.avgCostUsd, 'down')}
  taxa de fallback       ${fmtPct(base.totals.fallbackRate).padEnd(12)} ${fmtPct(now.totals.fallbackRate).padEnd(12)} ${delta(base.totals.fallbackRate, now.totals.fallbackRate, 'down')}
  tokens de saída        ${fmtNum(base.totals.avgOutputTokens).padEnd(12)} ${fmtNum(now.totals.avgOutputTokens).padEnd(12)} ${delta(base.totals.avgOutputTokens, now.totals.avgOutputTokens, 'down')}
  latência p95 (ms)      ${fmtNum(base.totals.p95ResponseMs).padEnd(12)} ${fmtNum(now.totals.p95ResponseMs).padEnd(12)} ${delta(base.totals.p95ResponseMs, now.totals.p95ResponseMs, 'down')}`)

  // Regressão por caso é o que decide se uma economia é aceitável. Uma taxa de
  // acerto estável pode esconder três casos que passaram a falhar e três que
  // passaram a acertar, e no caso da classificação isso não é empate.
  const baseById = new Map(base.results.map((r) => [r.id, r]))
  const regressions = now.results.filter((r) => {
    const b = baseById.get(r.id)
    return b?.passed === true && r.passed === false
  })
  const fixes = now.results.filter((r) => {
    const b = baseById.get(r.id)
    return b?.passed === false && r.passed === true
  })

  if (regressions.length > 0) {
    console.log(`\n  REGRESSÕES (passavam no baseline, agora falham):`)
    for (const r of regressions) console.log(`    ${r.id} (${r.track}): ${r.reason}`)
  }
  if (fixes.length > 0) {
    console.log(`\n  casos que passaram a acertar:`)
    for (const r of fixes) console.log(`    ${r.id} (${r.track}): ${r.reason}`)
  }
  if (regressions.length === 0 && fixes.length === 0) {
    console.log(`\n  nenhuma mudança caso a caso.`)
  }

  const petitionRegressions = regressions.filter((r) => r.track === 'petition')
  if (petitionRegressions.length > 0) {
    console.log(`
  ATENÇÃO: ${petitionRegressions.length} regressão(ões) na trilha de petição. A issue #65
  pede zero regressão de acerto na classificação. Reverta ou suba o effort.`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
