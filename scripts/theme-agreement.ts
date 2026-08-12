/**
 * Mede a concordância entre o classificador de tema por heurística e os temas
 * que o Haiku já gravou na tabela `Message` (issue #70).
 *
 * Existe porque a troca do Haiku pela heurística precisa ser verificável, e a
 * verificação não pode custar nada: todo o material de teste já está no banco.
 * O script não faz UMA chamada de API. Ele relê as perguntas já classificadas,
 * roda a heurística sobre elas e mostra a matriz de confusão.
 *
 * Como ler o resultado. O tema não entra no prompt do chat, então divergência
 * aqui não degrada resposta nenhuma; ela só borra um gráfico do painel. O que
 * importa é (a) a concordância global e (b) se a heurística está inflando
 * "Outros", que é o modo de falha que esvazia o gráfico. Uma concordância na
 * casa dos 80% já mantém a distribuição utilizável; abaixo de 60% vale ajustar
 * as regras em lib/theme.ts, ou voltar ao modelo gravando
 * `theme_classifier = llm` em `Setting`, sem deploy.
 *
 * Uso:
 *   npx tsx scripts/theme-agreement.ts
 *   npx tsx scripts/theme-agreement.ts --limit 2000
 */

import { PrismaClient } from '@prisma/client'
import { classifyThemeHeuristic } from '../lib/theme'
import { EVAL_OPERATOR_NAME } from '../lib/evalMode'

const prisma = new PrismaClient()

function parseLimit(): number {
  const i = process.argv.indexOf('--limit')
  if (i === -1) return 5_000
  const v = Number.parseInt(process.argv[i + 1] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 5_000
}

async function main(): Promise<void> {
  const rows = await prisma.message.findMany({
    where: {
      theme: { not: null },
      NOT: { operatorName: EVAL_OPERATOR_NAME },
    },
    orderBy: { createdAt: 'desc' },
    take: parseLimit(),
    select: { question: true, theme: true },
  })

  if (rows.length === 0) {
    console.log(
      'Nenhuma mensagem com tema gravado. Nada a comparar — o que é esperado\n' +
        'numa base nova ou logo após a troca para a heurística.'
    )
    return
  }

  let agree = 0
  // Matriz de confusão: tema do modelo -> tema da heurística -> contagem.
  const matrix = new Map<string, Map<string, number>>()

  for (const r of rows) {
    const expected = r.theme as string
    const got = classifyThemeHeuristic(r.question)
    if (expected === got) agree++
    if (!matrix.has(expected)) matrix.set(expected, new Map())
    const inner = matrix.get(expected)!
    inner.set(got, (inner.get(got) ?? 0) + 1)
  }

  const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`

  console.log(`\nmensagens comparadas: ${rows.length.toLocaleString('pt-BR')}`)
  console.log(`concordância global:  ${agree} (${pct(agree, rows.length)})\n`)

  console.log('por tema gravado pelo modelo:')
  for (const [expected, inner] of [...matrix.entries()].sort(
    (a, b) => sum(b[1]) - sum(a[1])
  )) {
    const total = sum(inner)
    const same = inner.get(expected) ?? 0
    console.log(`\n  ${expected}  (${total}, concordância ${pct(same, total)})`)
    for (const [got, n] of [...inner.entries()].sort((a, b) => b[1] - a[1])) {
      if (got === expected) continue
      console.log(`      -> ${got}: ${n} (${pct(n, total)})`)
    }
  }

  // O modo de falha que interessa: a heurística mandar tudo para "Outros".
  const toOutros = [...matrix.entries()].reduce(
    (s, [expected, inner]) =>
      expected === 'Outros' ? s : s + (inner.get('Outros') ?? 0),
    0
  )
  console.log(
    `\nclassificadas como "Outros" pela heurística tendo tema específico no modelo: ` +
      `${toOutros} (${pct(toOutros, rows.length)})`
  )
  console.log(
    'Se este número for alto, o gráfico esvazia. O ajuste é acrescentar termos\n' +
      'às regras de lib/theme.ts, que é onde a lista de palavras-chave vive.\n'
  )
}

function sum(m: Map<string, number>): number {
  let t = 0
  for (const v of m.values()) t += v
  return t
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
