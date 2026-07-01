import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { classifyTheme } from '@/lib/theme'

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
      detectedClient: true,
      ragFallback: true,
      ragTopScore: true,
    },
  })

  // Lazy-classify only truly old messages (no theme) — max 20 per call
  // New messages are classified at write time via classifyAndSaveTheme
  const unthemed = messages.filter((m) => !m.theme).slice(0, 20)
  if (unthemed.length > 0) {
    await Promise.all(
      unthemed.map(async (msg) => {
        const theme = await classifyTheme(msg.question)
        await prisma.message.update({
          where: { id: msg.id },
          data: { theme },
        })
        msg.theme = theme
      })
    )
  }

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

  // Cost data (Sonnet pricing per 1M tokens)
  const PRICE_INPUT = 3.00
  const PRICE_OUTPUT = 15.00
  const PRICE_CACHE_READ = 0.30
  const PRICE_CACHE_CREATION = 3.75

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0
  for (const m of messages) {
    totalInput += m.inputTokens ?? 0
    totalOutput += m.outputTokens ?? 0
    totalCacheRead += m.cacheReadTokens ?? 0
    totalCacheCreation += m.cacheCreationTokens ?? 0
  }
  const estimatedCostUsd =
    (totalInput / 1_000_000) * PRICE_INPUT +
    (totalOutput / 1_000_000) * PRICE_OUTPUT +
    (totalCacheRead / 1_000_000) * PRICE_CACHE_READ +
    (totalCacheCreation / 1_000_000) * PRICE_CACHE_CREATION
  const costWithoutCacheUsd =
    ((totalInput + totalCacheRead + totalCacheCreation) / 1_000_000) * PRICE_INPUT +
    (totalOutput / 1_000_000) * PRICE_OUTPUT
  const cacheSavingsUsd = costWithoutCacheUsd - estimatedCostUsd
  const totalInputLike = totalInput + totalCacheRead + totalCacheCreation
  const cacheHitRate = totalInputLike > 0 ? totalCacheRead / totalInputLike : 0

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
      ? ((avgInputFallback - avgInputRag) / 1_000_000) * PRICE_INPUT * fallbackMessages.length
      : null

  // Daily cost chart
  const costByDay = messages.reduce<Record<string, number>>((acc, msg) => {
    const day = msg.createdAt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const msgCost =
      ((msg.inputTokens ?? 0) / 1_000_000) * PRICE_INPUT +
      ((msg.outputTokens ?? 0) / 1_000_000) * PRICE_OUTPUT +
      ((msg.cacheReadTokens ?? 0) / 1_000_000) * PRICE_CACHE_READ +
      ((msg.cacheCreationTokens ?? 0) / 1_000_000) * PRICE_CACHE_CREATION
    acc[day] = (acc[day] ?? 0) + msgCost
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
    estimatedCostUsd,
    cacheSavingsUsd,
    cacheHitRate,
    fallbackRate,
    avgRagScore,
    fallbackCostUsd,
  }

  // Cost per message — hoje vs. ontem (independente do período selecionado)
  const cpmWhere = operatorName ? { operatorName } : {}
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  const [todayAgg, yesterdayAgg] = await Promise.all([
    prisma.message.aggregate({
      where: { ...cpmWhere, createdAt: { gte: todayStart, lt: tomorrowStart } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
    }),
    prisma.message.aggregate({
      where: { ...cpmWhere, createdAt: { gte: yesterdayStart, lt: todayStart } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
    }),
  ])

  const costFromAgg = (agg: typeof todayAgg) =>
    ((agg._sum.inputTokens ?? 0) / 1_000_000) * PRICE_INPUT +
    ((agg._sum.outputTokens ?? 0) / 1_000_000) * PRICE_OUTPUT +
    ((agg._sum.cacheReadTokens ?? 0) / 1_000_000) * PRICE_CACHE_READ +
    ((agg._sum.cacheCreationTokens ?? 0) / 1_000_000) * PRICE_CACHE_CREATION

  const costPerMessageToday = todayAgg._count.id > 0 ? costFromAgg(todayAgg) / todayAgg._count.id : null
  const costPerMessageYesterday =
    yesterdayAgg._count.id > 0 ? costFromAgg(yesterdayAgg) / yesterdayAgg._count.id : null
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
