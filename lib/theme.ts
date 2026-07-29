import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function classifyTheme(question: string): Promise<string> {
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

/**
 * Classifica e grava o tema da mensagem. Chamada em fire-and-forget a partir da
 * rota de chat, então a falha do update é tratada aqui: uma mensagem que ficasse
 * sem tema antes era reclassificada pelo backfill do dashboard em cada
 * carregamento, indefinidamente. O backfill foi removido (issue #70), então a
 * falha precisa aparecer no log em vez de virar uma reclassificação silenciosa.
 * Sem tema, a mensagem simplesmente conta como "Outros" na distribuição.
 */
export async function classifyAndSaveTheme(messageId: string, question: string): Promise<void> {
  const theme = await classifyTheme(question)
  try {
    await prisma.message.update({
      where: { id: messageId },
      data: { theme },
    })
  } catch (err) {
    console.warn('[theme] Falha ao gravar tema da mensagem:', JSON.stringify({
      messageId,
      theme,
      message: err instanceof Error ? err.message : String(err),
    }))
  }
}
