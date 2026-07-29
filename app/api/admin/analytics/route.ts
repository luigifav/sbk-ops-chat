import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import {
  CHAT_MODEL,
  LEGACY_MESSAGE_MODEL,
  costUsd,
  costWithoutCacheUsd,
  labelFor,
  pricingFor,
  splitCacheCreation,
  type TokenUsage,
} from '@/lib/pricing'

export const dynamic = 'force-dynamic'

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') ?? '30days'
  const exportCsv = searchParams.get('export') === 'csv'
  const operatorName = searchParams.get('operator') ?? null

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let dateRange: { gte?: Date; lt?: Date } = {}
  if (period === 'today') {
    dateRange = { gte: todayStart }
  } else if (period === 'yesterday') {
    dateRange = { gte: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000), lt: todayStart }
  } else if (period === '7days') {
    dateRange = { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
  } else if (period === '30days') {
    dateRange = { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
  }

  const where = {
    ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {}),
    ...(operatorName ? { operatorName } : {}),
  }

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      question: true,
      answer: true,
      operatorName: true,
      sessionId: true,
      responseTimeMs: true,
      createdAt: true,
      theme: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
      cacheCreation1hTokens: true,
      detectedClient: true,
      ragFallback: true,
      ragTopScore: true,
      model: true,
      stopReason: true,
    },
  })

  // Mensagens sem tema aparecem como "Outros" na distribuição abaixo (o
  // `?? 'Outros'` do themeCount cobre o caso). Não há backfill aqui de
  // propósito: abrir a tela de analytics disparava até 20 chamadas de modelo em
  // Promise.all mais 20 UPDATEs, e uma mensagem cujo update de tema falhasse
  // ficava sem tema para sempre, sendo reclassificada em cada carregamento do
  // dashboard, indefinidamente. Um caminho de leitura não deve gastar tokens
  // nem escrever no banco. A classificação acontece na gravação da mensagem,
  // via classifyAndSaveTheme (lib/theme.ts).

  if (exportCsv) {
    const header = 'id,operatorName,theme,question,answer,responseTimeMs,createdAt\n'
    const rows = messages
      .map((m) =>
        [
          escapeCsvField(m.id),
          escapeCsvField(m.operatorName ?? 'Anônimo'),
          escapeCsvField(m.theme ?? 'Outros'),
          escapeCsvField(m.question),
          escapeCsvField(m.answer),
          String(m.responseTimeMs),
          m.createdAt.toISOString(),
        ].join(',')
      )
      .join('\n')

    return new Response(header + rows, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sbk-analytics.csv"',
      },
    })
  }

  // Volume by day (Brazil timezone — en-CA locale gives YYYY-MM-DD format)
  const volumeByDay = messages.reduce<Record<string, number>>((acc, msg) => {
    const day = msg.createdAt.toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo',
    })
    acc[day] = (acc[day] ?? 0) + 1
    return acc
  }, {})

  const volumeChartData = Object.entries(volumeByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      date: new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      }),
      perguntas: count,
    }))

  // Theme distribution
  const themeCount = messages.reduce<Record<string, number>>((acc, msg) => {
    const t = msg.theme ?? 'Outros'
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {})

  const themeChartData = Object.entries(themeCount)
    .sort(([, a], [, b]) => b - a)
    .map(([theme, count]) => ({ theme, count }))

  // Operator stats
  const operatorStats = messages.reduce<
    Record<string, { total: number; avgResponseMs: number; totalMs: number }>
  >((acc, msg) => {
    const name = msg.operatorName ?? 'Anônimo'
    if (!acc[name]) acc[name] = { total: 0, avgResponseMs: 0, totalMs: 0 }
    acc[name].total += 1
    acc[name].totalMs += msg.responseTimeMs
    acc[name].avgResponseMs = Math.round(acc[name].totalMs / acc[name].total)
    return acc
  }, {})

  const operatorChartData = Object.entries(operatorStats)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([name, stats]) => ({ name, ...stats }))

  // Hourly distribution (Brazil timezone)
  const hourlyCount = messages.reduce<Record<number, number>>((acc, msg) => {
    const hour = parseInt(
      msg.createdAt.toLocaleString('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour: 'numeric',
        hour12: false,
      }),
      10
    )
    acc[hour] = (acc[hour] ?? 0) + 1
    return acc
  }, {})

  const hourlyChartData = Array.from({ length: 24 }, (_, h) => ({
    hora: `${String(h).padStart(2, '0')}h`,
    perguntas: hourlyCount[h] ?? 0,
  }))

  // Stats summary
  const totalMessages = messages.length
  const avgResponseMs =
    totalMessages > 0
      ? Math.round(messages.reduce((sum, m) => sum + m.responseTimeMs, 0) / totalMessages)
      : 0
  const uniqueOperators = new Set(messages.map((m) => m.operatorName)).size
  const topTheme = themeChartData[0]?.theme ?? '-'

  // Cost data — cada mensagem é precificada pelo modelo que a atendeu
  // (Message.model), com a tabela de preços em lib/pricing.ts. Mensagens
  // anteriores à coluna `model` caem em LEGACY_MESSAGE_MODEL.
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0
  // Gravações de cache separadas por TTL: a de 1 h custa 2,00x da entrada, a de
  // 5 min 1,25x (ver lib/pricing.ts). `totalCacheCreation` continua sendo o
  // total das duas, para que a linha de tokens do dashboard não mude de
  // significado.
  let totalCacheCreation1h = 0

  interface ModelBucket extends TokenUsage {
    messages: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    cacheCreation1hTokens: number
  }
  const buckets = new Map<string, ModelBucket>()

  for (const m of messages) {
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
  const cacheSavingsUsd = costWithoutCacheTotalUsd - estimatedCostUsd
  const totalInputLike = totalInput + totalCacheRead + totalCacheCreation
  const cacheHitRate = totalInputLike > 0 ? totalCacheRead / totalInputLike : 0

  const modelBreakdown = Array.from(buckets.entries())
    .map(([model, bucket]) => {
      const cost = costUsd(bucket, model)
      return {
        model,
        label: labelFor(model),
        messages: bucket.messages,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        cacheReadTokens: bucket.cacheReadTokens,
        cacheCreationTokens: bucket.cacheCreationTokens,
        // As duas faixas de TTL vão separadas para que a tabela de tokens do
        // dashboard consiga multiplicar cada uma pelo seu preço e fechar com o
        // custo do balde acima.
        cacheCreation5mTokens: bucket.cacheCreationTokens - bucket.cacheCreation1hTokens,
        cacheCreation1hTokens: bucket.cacheCreation1hTokens,
        costUsd: cost,
        costPerMessageUsd: bucket.messages > 0 ? cost / bucket.messages : null,
        prices: pricingFor(model),
      }
    })
    .sort((a, b) => b.costUsd - a.costUsd)

  // Modelo dominante do período (por custo). Usado nas estimativas que não
  // conseguem ser feitas por mensagem, como o custo extra de fallback.
  const primaryModel = modelBreakdown[0]?.model ?? CHAT_MODEL
  const primaryPrices = pricingFor(primaryModel)

  // Qualidade da resposta: truncamento por max_tokens e requisições que não
  // chegaram ao fim (timeout do stream ou erro da API). Ver lib/pricing.ts e o
  // stopReason gravado em app/api/chat/route.ts.
  const truncatedCount = messages.filter((m) => m.stopReason === 'max_tokens').length
  const truncationRate = totalMessages > 0 ? truncatedCount / totalMessages : 0
  const failedCount = messages.filter(
    (m) => m.stopReason === 'timeout' || m.stopReason === 'error'
  ).length

  // RAG fallback metrics
  const fallbackMessages = messages.filter((m) => m.ragFallback)
  const ragMessages = messages.filter((m) => !m.ragFallback && m.ragTopScore != null)
  const fallbackRate = totalMessages > 0 ? fallbackMessages.length / totalMessages : 0
  const avgRagScore =
    ragMessages.length > 0
      ? ragMessages.reduce((sum, m) => sum + (m.ragTopScore ?? 0), 0) / ragMessages.length
      : null

  // Estimate cost extra from fallbacks vs. using RAG chunks
  // Average inputTokens for RAG messages vs fallback messages
  const avgInputRag =
    ragMessages.length > 0
      ? ragMessages.reduce((s, m) => s + (m.inputTokens ?? 0), 0) / ragMessages.length
      : null
  const avgInputFallback =
    fallbackMessages.length > 0
      ? fallbackMessages.reduce((s, m) => s + (m.inputTokens ?? 0), 0) / fallbackMessages.length
      : null
  const fallbackCostUsd =
    avgInputRag != null && avgInputFallback != null
      ? ((avgInputFallback - avgInputRag) / 1_000_000) * primaryPrices.input * fallbackMessages.length
      : null

  // Daily cost chart
  const costByDay = messages.reduce<Record<string, number>>((acc, msg) => {
    const day = msg.createdAt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    acc[day] = (acc[day] ?? 0) + costUsd(msg, msg.model)
    return acc
  }, {})

  const dailyCostChartData = Object.entries(costByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cost]) => ({
      date: new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      }),
      custo: parseFloat(cost.toFixed(4)),
    }))

  const costData = {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreation,
    totalCacheCreation5m: totalCacheCreation - totalCacheCreation1h,
    totalCacheCreation1h,
    estimatedCostUsd,
    cacheSavingsUsd,
    cacheHitRate,
    fallbackRate,
    avgRagScore,
    fallbackCostUsd,
    modelBreakdown,
    truncatedCount,
    truncationRate,
    failedCount,
  }

  // Cost per message — hoje vs. ontem (independente do período selecionado)
  const cpmWhere = operatorName ? { operatorName } : {}
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  // Agrupado por modelo para que o custo por mensagem seja precificado com o
  // preço de quem atendeu, e não com um preço único assumido para o período. A
  // soma de cacheCreation1hTokens entra junto porque este card é justamente o
  // que compara o custo médio antes e depois do TTL de 1 h (issue #64): sem ela,
  // toda gravação nova seria cobrada a 1,25x em vez de 2,00x e o card mostraria
  // uma economia que não existe.
  const [todayGroups, yesterdayGroups] = await Promise.all([
    prisma.message.groupBy({
      by: ['model'],
      where: { ...cpmWhere, createdAt: { gte: todayStart, lt: tomorrowStart } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        cacheCreation1hTokens: true,
      },
      _count: { id: true },
    }),
    prisma.message.groupBy({
      by: ['model'],
      where: { ...cpmWhere, createdAt: { gte: yesterdayStart, lt: todayStart } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        cacheCreation1hTokens: true,
      },
      _count: { id: true },
    }),
  ])

  const costPerMessageFromGroups = (groups: typeof todayGroups) => {
    let cost = 0
    let count = 0
    for (const g of groups) {
      cost += costUsd(
        {
          inputTokens: g._sum.inputTokens,
          outputTokens: g._sum.outputTokens,
          cacheReadTokens: g._sum.cacheReadTokens,
          cacheCreationTokens: g._sum.cacheCreationTokens,
          cacheCreation1hTokens: g._sum.cacheCreation1hTokens,
        },
        g.model
      )
      count += g._count.id
    }
    return count > 0 ? cost / count : null
  }

  const costPerMessageToday = costPerMessageFromGroups(todayGroups)
  const costPerMessageYesterday = costPerMessageFromGroups(yesterdayGroups)
  const costPerMessageDeltaPercent =
    costPerMessageToday != null && costPerMessageYesterday != null && costPerMessageYesterday > 0
      ? ((costPerMessageToday - costPerMessageYesterday) / costPerMessageYesterday) * 100
      : null

  const costPerMessageData = {
    today: costPerMessageToday,
    yesterday: costPerMessageYesterday,
    deltaPercent: costPerMessageDeltaPercent,
  }

  // Client breakdown
  const clientCount = messages.reduce<Record<string, number>>((acc, msg) => {
    const c = msg.detectedClient ?? 'Não identificado'
    acc[c] = (acc[c] ?? 0) + 1
    return acc
  }, {})
  const clientChartData = Object.entries(clientCount)
    .sort(([, a], [, b]) => b - a)
    .map(([client, count]) => ({ client, count }))

  // Operator list for filter dropdown
  const allOperators = await prisma.message.groupBy({
    by: ['operatorName'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  return NextResponse.json({
    summary: { totalMessages, avgResponseMs, uniqueOperators, topTheme },
    volumeChartData,
    themeChartData,
    operatorChartData,
    hourlyChartData,
    costData,
    costPerMessageData,
    clientChartData,
    dailyCostChartData,
    messages: messages.slice(0, 200),
    operators: allOperators.map((o) => ({
      name: o.operatorName,
      total: o._count.id,
    })),
  })
}
