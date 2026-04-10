import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

async function classifyTheme(question: string): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: `Você é um classificador de perguntas de operadores de Legal Operations.

Temas fixos disponíveis:
- Prazo e SLA: perguntas sobre prazos, SLAs, datas limite
- Sistema e acesso: perguntas sobre sistemas, logins, acessos, ferramentas
- Processo operacional: perguntas sobre como executar processos, procedimentos
- Dúvida sobre cliente: perguntas específicas sobre Bradesco, Agibank, Eagle, Zurich ou outros clientes
- Outros: não se encaixa nos anteriores

Se identificar um padrão recorrente diferente dos temas acima, nomeie o tema livremente em até 3 palavras.

Pergunta: "${question.slice(0, 300)}"

Responda APENAS com o nome do tema, sem explicação, sem pontuação.`,
        },
      ],
    })
    return response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : 'Outros'
  } catch {
    return 'Outros'
  }
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
  let startDate: Date | undefined
  if (period === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  } else if (period === '7days') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (period === '30days') {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  const where = {
    ...(startDate ? { createdAt: { gte: startDate } } : {}),
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
    },
  })

  // Classify unthemed messages (max 50 per request to control cost)
  const unthemed = messages.filter((m) => !m.theme).slice(0, 50)
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
    messages: messages.slice(0, 200),
    operators: allOperators.map((o) => ({
      name: o.operatorName,
      total: o._count.id,
    })),
  })
}
