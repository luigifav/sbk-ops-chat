import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { EVAL_OPERATOR_NAME } from '@/lib/evalMode'
import { costUsd, inputSideCostUsd, labelFor, pricingFor } from '@/lib/pricing'
import { computeMessageMetrics } from '@/lib/metrics'

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

  // O operador do harness de avaliação fica FORA das métricas por padrão.
  //
  // Uma rodada do harness são dezenas de mensagens de uma vez, com perguntas que
  // ninguém fez e respostas que ninguém leu. Todo dia em que alguém rodar o eval
  // vira um pico de custo e de volume no painel, e é justamente o painel que vai
  // ser usado para decidir se uma otimização economizou: a medição contaminaria
  // exatamente a comparação que o harness existe para viabilizar. Tanto
  // evals/extract.ts quanto scripts/measure.ts já excluem este operador; a rota
  // do dashboard era a que faltava.
  //
  // Quando o operador é escolhido explicitamente no filtro, a exclusão cede:
  // selecionar `__eval__` no dropdown e receber zero mensagens seria confuso.
  // O `AND` é explícito de propósito — dois spreads da mesma chave
  // `operatorName` no mesmo objeto se sobrescreveriam em silêncio.
  const where: Prisma.MessageWhereInput = {
    ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {}),
    ...(operatorName
      ? { operatorName }
      : { NOT: { operatorName: EVAL_OPERATOR_NAME } }),
  }

  // Quantas mensagens a tabela de "perguntas recentes" devolve ao cliente. O
  // dashboard renderiza 50 deste conjunto.
  const RECENT_MESSAGES_LIMIT = 200

  // Exportação de CSV: é o único consumidor que precisa de `question` e `answer`
  // de todas as mensagens do período, e sai antes dos agregados para que o
  // caminho normal do dashboard nunca pague por esse volume.
  if (exportCsv) {
    const csvRows = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        operatorName: true,
        theme: true,
        question: true,
        answer: true,
        responseTimeMs: true,
        createdAt: true,
      },
    })

    const header = 'id,operatorName,theme,question,answer,responseTimeMs,createdAt\n'
    const rows = csvRows
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

  // Conjunto que alimenta TODOS os agregados desta rota. `question` e `answer`
  // ficam fora de propósito: nenhum agregado os usa, e no payload só entram as
  // perguntas das RECENT_MESSAGES_LIMIT mais recentes, buscadas em consulta
  // própria mais abaixo. Selecioná-los aqui movia o texto integral de toda
  // mensagem do período do banco para a função a cada carregamento do dashboard,
  // para exibir 50 delas truncadas. Num período de 30 dias isso é a maior
  // transferência de dados do projeto, e transferência é recurso cobrado e
  // limitado à parte dos tokens.
  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
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
      // Composição do prompt. Alimenta o card que responde de qual bloco vem o
      // custo de entrada, que é o que decide o que dá para encolher.
      fixedChars: true,
      clientChars: true,
      fallbackChars: true,
      historyChars: true,
      contextCapHit: true,
    },
  })

  // Mensagens sem tema aparecem como "Outros" na distribuição abaixo (o
  // `?? 'Outros'` do themeCount cobre o caso). Não há backfill aqui de
  // propósito: abrir a tela de analytics disparava até 20 chamadas de modelo em
  // Promise.all mais 20 UPDATEs, e uma mensagem cujo update de tema falhasse
  // ficava sem tema para sempre, sendo reclassificada em cada carregamento do
  // dashboard, indefinidamente. Um caminho de leitura não deve gastar tokens
  // nem escrever no banco. A classificação acontece na gravação da mensagem,
  // via classifyTheme (lib/theme.ts), que no modo padrão é heurística e não
  // gasta token nenhum.


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

  // Cost data: cada mensagem é precificada pelo modelo que a atendeu
  // (Message.model), com a tabela de preços em lib/pricing.ts. Mensagens
  // anteriores à coluna `model` caem em LEGACY_MESSAGE_MODEL.
  //
  // As fórmulas vivem em lib/metrics.ts, e não aqui, porque scripts/measure.ts
  // compara duas janelas de tempo usando exatamente as mesmas contas. Duplicá-las
  // faria o script e o dashboard divergirem na primeira mudança de preço.
  const metrics = computeMessageMetrics(messages)
  const {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreation,
    totalCacheCreation1h,
    estimatedCostUsd,
    cacheSavingsUsd,
    cacheHitRate,
    cacheReadsPerWrite,
    buckets,
  } = metrics

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

  // Qualidade da resposta (truncamento por max_tokens, requisições que não
  // chegaram ao fim) e saúde do RAG: calculados em lib/metrics.ts.
  const { truncatedCount, truncationRate, failedCount, fallbackRate, avgRagScore } = metrics

  // Custo extra atribuível ao fallback do RAG.
  //
  // Compara o custo do LADO DE ENTRADA das mensagens que caíram no fallback com
  // o das que usaram trechos recuperados, e multiplica a diferença pelo número
  // de mensagens de fallback do período.
  //
  // Antes esta conta comparava a média de `inputTokens` dos dois grupos, e o
  // número saía errado com o sinal invertido: o dump de documentos do fallback é
  // um bloco CACHEADO (cache_control em buildSystemBlocks), então os tokens dele
  // vão para `cacheReadTokens`/`cacheCreationTokens` e nunca para `inputTokens`,
  // enquanto os trechos de RAG do caminho normal não são cacheados e caem
  // inteiros em `inputTokens`. Medido assim, o caminho caro parecia o barato e o
  // card do dashboard tendia a zero ou a um número negativo. Ver
  // `inputSideCostUsd` em lib/pricing.ts.
  //
  // Cada linha é precificada pelo modelo que a atendeu (`m.model`), não pelo
  // modelo predominante do período: uma troca de modelo no meio da série faria a
  // média misturar preços diferentes.
  const fallbackRows = messages.filter((m) => m.ragFallback)
  const ragRows = messages.filter((m) => !m.ragFallback && m.ragTopScore != null)
  const avgInputCost = (rows: typeof messages): number | null =>
    rows.length > 0
      ? rows.reduce((s, m) => s + inputSideCostUsd(m, m.model), 0) / rows.length
      : null
  const avgCostRag = avgInputCost(ragRows)
  const avgCostFallback = avgInputCost(fallbackRows)
  const fallbackCostUsd =
    avgCostRag != null && avgCostFallback != null
      ? (avgCostFallback - avgCostRag) * fallbackRows.length
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

  // COMPOSIÇÃO DO PROMPT, agregada sobre as linhas que têm a instrumentação.
  //
  // Só entram linhas com `fixedChars` não nulo: as anteriores à migração não
  // foram medidas, e tratá-las como zero puxaria todas as médias para baixo e
  // faria o prefixo parecer menor do que é justamente na comparação
  // antes/depois. `measured` diz sobre quantas mensagens a média foi feita, para
  // o painel não sugerir conclusão em cima de amostra pequena.
  const composed = messages.filter((m) => m.fixedChars != null)
  const avgOf = (pick: (m: (typeof composed)[number]) => number | null): number | null =>
    composed.length > 0
      ? Math.round(composed.reduce((s, m) => s + (pick(m) ?? 0), 0) / composed.length)
      : null
  const promptComposition = {
    measured: composed.length,
    avgFixedChars: avgOf((m) => m.fixedChars),
    avgClientChars: avgOf((m) => m.clientChars),
    avgFallbackChars: avgOf((m) => m.fallbackChars),
    avgHistoryChars: avgOf((m) => m.historyChars),
    // Fração das mensagens medidas em que o cap de 80.000 caracteres cortou
    // documentação. Se ficar em zero por semanas, o número 80.000 não morde e
    // mexer nele economiza exatamente nada. Se for maior que zero, o problema
    // não é o valor do cap: é o modelo responder com corpus incompleto sem
    // nenhum sinal disso no prompt.
    contextCapHitRate:
      composed.length > 0
        ? composed.filter((m) => m.contextCapHit).length / composed.length
        : null,
  }

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
    cacheReadsPerWrite,
    fallbackRate,
    avgRagScore,
    fallbackCostUsd,
    promptComposition,
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

  // As perguntas recentes da tabela do dashboard. Só aqui `question` sai do
  // banco, e só para as linhas que realmente vão ao cliente. `answer` não entra:
  // nada na tela o exibe, e o tipo AnalyticsMessage do dashboard nem o declara.
  const recentMessages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: RECENT_MESSAGES_LIMIT,
    select: {
      id: true,
      question: true,
      operatorName: true,
      theme: true,
      createdAt: true,
      responseTimeMs: true,
    },
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
    messages: recentMessages,
    operators: allOperators.map((o) => ({
      name: o.operatorName,
      total: o._count.id,
    })),
  })
}
