import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const BASE_SYSTEM_PROMPT =
  'Você é o assistente operacional da SBK, empresa de Legal Operations. ' +
  'Responda dúvidas dos operadores sobre processos, sistemas e procedimentos internos. ' +
  'Seja direto e objetivo. Nunca invente informações fora da documentação fornecida. ' +
  'Se a dúvida não estiver coberta, oriente o operador a escalar para o suporte SBK.'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  // Verify operator auth
  const authToken = req.cookies.get('sbk_auth_token')?.value
  if (!authToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const isValid = await verifyToken(
    authToken,
    process.env.ACCESS_PASSWORD!,
    process.env.AUTH_SECRET!
  )
  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { messages, sessionId } = body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      sessionId: string
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 })
    }

    // Build system prompt using RAG or fallback to full document injection
    let systemPrompt = BASE_SYSTEM_PROMPT
    const CONTEXT_CHAR_CAP = 80_000

    try {
      // Try RAG: embed the user query and fetch relevant chunks
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
      const queryText = lastUserMessage?.content ?? ''

      if (queryText) {
        const { embedQuery } = await import('@/lib/embeddings')
        const queryEmbedding = await embedQuery(queryText)
        const vectorLiteral = `[${queryEmbedding.join(',')}]`

        const chunks = await prisma.$queryRawUnsafe<
          Array<{ content: string; documentId: string; score: unknown }>
        >(
          `SELECT dc.content, dc."documentId", 1 - (dc.embedding <=> $1::vector) as score
           FROM "DocumentChunk" dc
           JOIN "Document" d ON d.id = dc."documentId"
           WHERE d.active = true
           ORDER BY dc.embedding <=> $1::vector
           LIMIT 5`,
          vectorLiteral
        )

        if (chunks.length > 0) {
          const contextText = chunks
            .map((c, i) => `### Trecho ${i + 1} (relevância: ${(Number(c.score) * 100).toFixed(0)}%)\n\n${c.content}`)
            .join('\n\n---\n\n')
          systemPrompt += `\n\n## Trechos relevantes da documentação\n\n${contextText}`
        } else {
          // Fallback: no chunks exist yet, inject full documents with cap
          throw new Error('no_chunks')
        }
      }
    } catch (ragError: unknown) {
      console.error('[chat] RAG failed, falling back to full document injection:', ragError)
      // Fallback: inject full documents up to CONTEXT_CHAR_CAP
      try {
        const documents = await prisma.document.findMany({
          where: { active: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
          select: { name: true, content: true },
        })

        if (documents.length > 0) {
          let total = 0
          const selected: typeof documents = []

          for (const doc of documents) {
            if (total + doc.content.length > CONTEXT_CHAR_CAP) {
              console.warn(`[chat] Context cap reached at document "${doc.name}", skipping remaining`)
              break
            }
            selected.push(doc)
            total += doc.content.length
          }

          if (selected.length > 0) {
            const docsText = selected
              .map((doc, i) => `### Documento ${i + 1}: ${doc.name}\n\n${doc.content}`)
              .join('\n\n---\n\n')
            systemPrompt += `\n\n## Documentação Operacional\n\n${docsText}`
          }
        }
      } catch {
        // Proceed with base prompt only
      }
    }

    // Extract question text for logging (last user message)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    const question = lastUserMsg?.content ?? ''

    const startTime = Date.now()
    const encoder = new TextEncoder()
    let fullResponse = ''

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            messages: messages as Anthropic.MessageParam[],
            stream: true,
          })

          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              const text = event.delta.text
              fullResponse += text
              controller.enqueue(encoder.encode(text))
            }
          }

          // Log interaction to DB after streaming completes
          const responseTimeMs = Date.now() - startTime
          try {
            await prisma.message.create({
              data: {
                question,
                answer: fullResponse,
                sessionId: sessionId ?? 'unknown',
                responseTimeMs,
              },
            })
          } catch {
            // Do not fail the request if logging fails
          }

          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
