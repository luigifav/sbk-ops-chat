/**
 * Compara duas janelas de tempo da tabela `Message` e imprime o diff das
 * métricas de custo, cache, saúde do RAG e latência.
 *
 * Serve para fechar os critérios de "medido antes" e "medido depois" das issues
 * de custo (#61, #64, #65) sem depender de ler o dashboard na mão. E resolve um
 * problema que parecia perdido: o baseline "antes de qualquer mudança" não exige
 * ter sido coletado na época. As colunas de token, `ragFallback`, `ragTopScore` e
 * `stopReason` são por mensagem e têm `createdAt`, então basta recortar a janela
 * anterior ao deploy e o baseline sai em retrospecto.
 *
 * As contas vêm de lib/metrics.ts, as mesmas que o dashboard usa. Se um número
 * aqui discordar de lá, é bug, não duas fórmulas diferentes.
 *
 * Uso:
 *
 *   # Janelas explícitas (fim exclusivo)
 *   npm run measure -- --before 2026-07-01..2026-07-15 --after 2026-07-15..2026-07-29
 *
 *   # Simétrico em torno do deploy: N dias antes e N dias depois
 *   npm run measure -- --split 2026-07-29 --days 7
 *
 *   # Só uma janela, sem comparação
 *   npm run measure -- --window 2026-07-01..2026-07-29
 *
 *   # Restringe a um operador, e exclui as mensagens do harness de avaliação
 *   npm run measure -- --split 2026-07-29 --days 7 --operator "Maria"
 *   npm run measure -- --split 2026-07-29 --days 7 --exclude-eval
 *
 *   # JSON, para colar em issue ou versionar
 *   npm run measure -- --split 2026-07-29 --days 7 --json
 */

import { PrismaClient } from '@prisma/client'
import { computeMessageMetrics, type MessageMetrics } from '../lib/metrics'
import { labelFor } from '../lib/pricing'
import { EVAL_OPERATOR_NAME } from '../lib/evalMode'

const prisma = new PrismaClient()

interface Window {
  label: string
  from: Date
  to: Date
}

function fail(message: string): never {
  console.error(`erro: ${message}\n`)
  console.error('Uso: npm run measure -- --before A..B --after C..D')
  console.error('     npm run measure -- --split YYYY-MM-DD --days N')
  console.error('     npm run measure -- --window A..B')
  process.exit(1)
}

/** Aceita YYYY-MM-DD (meia-noite local) ou um ISO completo. */
function parseDate(raw: string, what: string): Date {
  const trimmed = raw.trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  // Data pura é interpretada como meia-noite LOCAL, não UTC, para bater com a
  // leitura de quem opera no fuso de São Paulo. `new Date('2026-07-01')` sozinho
  // daria meia-noite UTC e deslocaria a janela em três horas.
  const d = dateOnly ? new Date(`${trimmed}T00:00:00`) : new Date(trimmed)
  if (Number.isNaN(d.getTime())) fail(`${what} inválida: "${raw}"`)
  return d
}

/** Rótulo da janela única, usado quando não há comparação a fazer. */
const SINGLE_WINDOW_LABEL = 'período'

function parseRange(raw: string, label: string): Window {
  const parts = raw.split('..')
  if (parts.length !== 2) fail(`${label}: precisa do formato INICIO..FIM, recebi "${raw}"`)
  const from = parseDate(parts[0], `${label}: data inicial`)
  const to = parseDate(parts[1], `${label}: data final`)
  if (to <= from) fail(`${label}: a janela termina antes de começar`)
  return { label, from, to }
}

function parseArgs(argv: string[]): {
  windows: Window[]
  operator: string | null
  excludeEval: boolean
  json: boolean
} {
  const flags = new Map<string, string>()
  const bare = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags.set(key, next)
      i++
    } else {
      bare.add(key)
    }
  }

  const operator = flags.get('operator') ?? null
  const excludeEval = bare.has('exclude-eval')
  const json = bare.has('json')

  if (flags.has('window')) {
    return {
      windows: [parseRange(flags.get('window')!, SINGLE_WINDOW_LABEL)],
      operator,
      excludeEval,
      json,
    }
  }

  if (flags.has('split')) {
    const split = parseDate(flags.get('split')!, 'data de split')
    const days = Number.parseInt(flags.get('days') ?? '7', 10)
    if (!Number.isFinite(days) || days <= 0) fail(`--days precisa ser inteiro positivo`)
    const ms = days * 24 * 60 * 60 * 1_000
    // Janelas do mesmo tamanho de propósito: comparar 3 dias contra 14 é o erro
    // mais fácil de cometer aqui, e ele infla ou esconde qualquer diferença.
    return {
      windows: [
        { label: 'antes', from: new Date(split.getTime() - ms), to: split },
        { label: 'depois', from: split, to: new Date(split.getTime() + ms) },
      ],
      operator,
      excludeEval,
      json,
    }
  }

  if (flags.has('before') && flags.has('after')) {
    const before = parseRange(flags.get('before')!, 'antes')
    const after = parseRange(flags.get('after')!, 'depois')
    return { windows: [before, after], operator, excludeEval, json }
  }

  fail('informe --window, ou --split com --days, ou --before junto com --after')
}

function durationDays(w: Window): number {
  return (w.to.getTime() - w.from.getTime()) / (24 * 60 * 60 * 1_000)
}

async function loadWindow(
  w: Window,
  operator: string | null,
  excludeEval: boolean
): Promise<MessageMetrics> {
  const rows = await prisma.message.findMany({
    where: {
      createdAt: { gte: w.from, lt: w.to },
      ...(operator ? { operatorName: operator } : {}),
      ...(excludeEval ? { operatorName: { not: EVAL_OPERATOR_NAME } } : {}),
    },
    select: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
      cacheCreation1hTokens: true,
      model: true,
      ragFallback: true,
      ragTopScore: true,
      stopReason: true,
      responseTimeMs: true,
    },
  })
  return computeMessageMetrics(rows)
}

type Fmt = 'int' | 'pct' | 'usd' | 'usd4' | 'score' | 'ms'
type Dir = 'up' | 'down' | 'neutral'

interface Line {
  label: string
  pick: (m: MessageMetrics) => number | null
  fmt: Fmt
  /** Para qual lado a métrica melhora. Só afeta o rótulo, não o número. */
  better: Dir
}

const LINES: Line[] = [
  { label: 'Mensagens', pick: (m) => m.totalMessages, fmt: 'int', better: 'neutral' },
  { label: 'Custo total (USD)', pick: (m) => m.estimatedCostUsd, fmt: 'usd', better: 'down' },
  { label: 'Custo por mensagem (USD)', pick: (m) => m.costPerMessageUsd, fmt: 'usd4', better: 'down' },
  { label: 'Cache hit rate', pick: (m) => m.cacheHitRate, fmt: 'pct', better: 'up' },
  { label: 'Economia com cache (USD)', pick: (m) => m.cacheSavingsUsd, fmt: 'usd', better: 'up' },
  { label: 'Gravação de cache 5 min', pick: (m) => m.totalCacheCreation5m, fmt: 'int', better: 'neutral' },
  { label: 'Gravação de cache 1 h', pick: (m) => m.totalCacheCreation1h, fmt: 'int', better: 'neutral' },
  { label: 'Taxa de fallback do RAG', pick: (m) => m.fallbackRate, fmt: 'pct', better: 'down' },
  { label: 'avgRagScore', pick: (m) => m.avgRagScore, fmt: 'score', better: 'up' },
  { label: 'Tokens de saída por mensagem', pick: (m) => m.avgOutputTokens, fmt: 'int', better: 'down' },
  { label: 'Latência média', pick: (m) => m.avgResponseMs, fmt: 'ms', better: 'down' },
  { label: 'Latência p95', pick: (m) => m.p95ResponseMs, fmt: 'ms', better: 'down' },
  { label: 'Taxa de truncamento', pick: (m) => m.truncationRate, fmt: 'pct', better: 'down' },
  { label: 'Requisições que falharam', pick: (m) => m.failedCount, fmt: 'int', better: 'down' },
]

function render(value: number | null, fmt: Fmt): string {
  if (value == null) return '-'
  switch (fmt) {
    case 'int': return Math.round(value).toLocaleString('pt-BR')
    case 'pct': return `${(value * 100).toFixed(1)}%`
    case 'usd': return `$${value.toFixed(4)}`
    case 'usd4': return `$${value.toFixed(5)}`
    case 'score': return value.toFixed(4)
    case 'ms': return `${Math.round(value).toLocaleString('pt-BR')} ms`
  }
}

function renderDelta(before: number | null, after: number | null, better: Dir): string {
  if (before == null || after == null) return '-'
  const abs = after - before
  if (before === 0) return abs === 0 ? 'igual' : 'de zero'
  const pct = (abs / Math.abs(before)) * 100
  if (Math.abs(pct) < 0.05) return 'igual'
  const sign = pct > 0 ? '+' : ''
  const arrow = pct > 0 ? 'subiu' : 'caiu'
  if (better === 'neutral') return `${sign}${pct.toFixed(1)}%`
  const improved = (better === 'down' && pct < 0) || (better === 'up' && pct > 0)
  return `${sign}${pct.toFixed(1)}% (${arrow}, ${improved ? 'melhor' : 'pior'})`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}
function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s
}

async function main() {
  const { windows, operator, excludeEval, json } = parseArgs(process.argv.slice(2))

  const results: Array<{ window: Window; metrics: MessageMetrics }> = []
  for (const w of windows) {
    results.push({ window: w, metrics: await loadWindow(w, operator, excludeEval) })
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          operator,
          excludeEval,
          windows: results.map(({ window, metrics }) => ({
            label: window.label,
            from: window.from.toISOString(),
            to: window.to.toISOString(),
            days: durationDays(window),
            // `buckets` é um Map e não sobrevive ao JSON, então vira objeto.
            metrics: { ...metrics, buckets: Object.fromEntries(metrics.buckets) },
          })),
        },
        null,
        2
      )
    )
    return
  }

  const fmtRange = (w: Window) =>
    `${w.from.toLocaleString('pt-BR')} a ${w.to.toLocaleString('pt-BR')} (${durationDays(w)}d)`

  console.log('')
  for (const { window } of results) {
    console.log(`${pad(window.label, 8)} ${fmtRange(window)}`)
  }
  if (operator) console.log(`operador: ${operator}`)
  if (excludeEval) console.log(`excluindo mensagens de ${EVAL_OPERATOR_NAME}`)
  console.log('')

  const single = results.length === 1
  const W_LABEL = 30
  const W_VAL = 18

  let header = pad('Métrica', W_LABEL)
  for (const { window } of results) header += padLeft(window.label, W_VAL)
  if (!single) header += '   ' + 'variação'
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const line of LINES) {
    let row = pad(line.label, W_LABEL)
    for (const { metrics } of results) {
      row += padLeft(render(line.pick(metrics), line.fmt), W_VAL)
    }
    if (!single) {
      const a = line.pick(results[0].metrics)
      const b = line.pick(results[1].metrics)
      row += '   ' + renderDelta(a, b, line.better)
    }
    console.log(row)
  }

  console.log('')
  for (const { window, metrics } of results) {
    const models = Array.from(metrics.buckets.keys()).map(labelFor).join(', ')
    console.log(`${window.label}: modelos = ${models || 'nenhum'}`)
  }

  // Amostra pequena engana: com poucas mensagens, uma variação de dezenas de
  // por cento pode ser ruído. O aviso é para não fechar a issue com 12 mensagens.
  const thin = results.filter(({ metrics }) => metrics.totalMessages < 30)
  if (thin.length > 0) {
    console.log('')
    for (const { window, metrics } of thin) {
      console.log(
        `aviso: a janela "${window.label}" tem ${metrics.totalMessages} mensagens. ` +
          `Abaixo de umas 30, a variação percentual é mais ruído que sinal.`
      )
    }
  }
  console.log('')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
