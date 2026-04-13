import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

type Period = 'today' | '7days' | '30days' | 'all'

function getStartDate(period: Period): Date | undefined {
  const now = new Date()
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  if (period === '7days') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  }
  if (period === '30days') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }
  return undefined
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
  const period = (searchParams.get('period') ?? 'all') as Period
  const rawSearch = searchParams.get('search') ?? ''
  // Limit search string length to prevent ReDoS and log abuse
  const MAX_SEARCH_LENGTH = 200
  const search = rawSearch.slice(0, MAX_SEARCH_LENGTH)
  const exportCsv = searchParams.get('export') === 'csv'

  const startDate = getStartDate(period)

  const where = {
    ...(startDate ? { createdAt: { gte: startDate } } : {}),
    ...(search
      ? { question: { contains: search, mode: 'insensitive' as const } }
      : {}),
  }

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  if (exportCsv) {
    const header = 'id,sessionId,question,answer,responseTimeMs,createdAt\n'
    const rows = messages
      .map((m) =>
        [
          escapeCsvField(m.id),
          escapeCsvField(m.sessionId),
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
        'Content-Disposition': 'attachment; filename="sbk-messages.csv"',
      },
    })
  }

  // Compute stats independently of current filters
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [today, last7days, last30days, total] = await Promise.all([
    prisma.message.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.message.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.message.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.message.count(),
  ])

  return NextResponse.json({
    messages,
    stats: { today, last7days, last30days, total },
  })
}
