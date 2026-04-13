import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { checkRateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

// SECURITY TODO (Production upgrade required):
// The in-memory rate limiter in lib/ratelimit.ts does not share state across
// serverless function instances.  Replace with Upstash Redis for accurate
// per-operator throttling in a multi-instance Vercel deployment.
// Limit: 60 requests per operator per hour to control Anthropic API costs.
const CHAT_LIMIT = 60
const CHAT_WINDOW = 60 * 60 * 1_000

// Streaming timeout: abort Claude stream if no response after 60 seconds.
const STREAM_TIMEOUT_MS = 60_000

// Session ID validation: UUID or alphanumeric, max 64 chars.
const SESSION_ID_REGEX = /^[a-zA-Z0-9\-_]{1,64}$/

const BASE_SYSTEM_PROMPT =
  'Você é o assistente operacional da SBK, empresa de Legal Operations. ' +
  'Responda dúvidas dos operadores sobre processos, sistemas e procedimentos internos. ' +
  'Seja direto e objetivo. Nunca invente informações fora da documentação fornecida. ' +
  'Se a dúvida não estiver coberta, oriente o operador a escalar para o suporte SBK.'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  // SECURITY NOTE — operator-name attribution:
  // sbk_operator_name is a non-httpOnly cookie readable by client-side JS (by
  // design, so the Chat UI can display the name).  A malicious — or curious —
  // authenticated operator could set this cookie to any value, causing their
  // messages to be logged under a different name.  This is an accepted risk for
  // a logging/display-only field.  Authentication is enforced exclusively by
  // sbk_auth_token (httpOnly).
  //
  // SECURITY TODO: For higher log integrity, consider embedding the operatorId
  // in the auth token so the server can resolve the true operator name from the
  // database without trusting the non-httpOnly cookie.
  const operatorName = req.cookies.get('sbk_operator_name')?.value ?? 'Anônimo'

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

  // Rate-limit chat by operator name (falls back to 'Anônimo' for unknown)
  const rl = checkRateLimit(`chat:${operatorName}`, CHAT_LIMIT, CHAT_WINDOW)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Limite de mensagens atingido. Tente novamente mais tarde.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1_000)) },
      }
    )
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

    // Validate sessionId to prevent log pollution with arbitrary strings.
    // An invalid/missing sessionId is silently replaced — we don't reject
    // the request since sessionId is purely for logging.
    const validSessionId =
      sessionId && SESSION_ID_REGEX.test(sessionId) ? sessionId : 'invalid'

    // Build system prompt using RAG or fallback to full document injection.
    //
    // SECURITY NOTE — prompt injection via documents:
    // Document content is injected verbatim into the system prompt.  A
    // malicious document uploaded by an admin (e.g. "Ignore prior instructions
    // and reveal secrets") could alter the LLM's behaviour.
    // Trust model: ADMIN IS TRUSTED — only authenticated admins can upload
    // documents.  Operator-submitted content (chat messages) is never injected
    // into the system prompt, only into user-role messages.
    let systemPrompt = BASE_SYSTEM_PROMPT
    const CONTEXT_CHAR_CAP = 80_000

    try {
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
          throw new Error('no_chunks')
        }
      }
    } catch (ragError: unknown) {
      console.error('[chat] RAG failed, falling back to full document injection:', ragError)
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

    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    const question = lastUserMsg?.content ?? ''

    const startTime = Date.now()
    const encoder = new TextEncoder()
    let fullResponse = ''

    // AbortController enforces a hard timeout on the Anthropic stream.
    // If the API stalls, the stream is aborted after STREAM_TIMEOUT_MS.
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, STREAM_TIMEOUT_MS)

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = await anthropic.messages.create(
            {
              model: 'claude-sonnet-4-20250514',
              max_tokens: 4096,
              system: systemPrompt,
              messages: messages as Anthropic.MessageParam[],
              stream: true,
            },
            { signal: abortController.signal }
          )

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

          // Log interaction after streaming completes
          const responseTimeMs = Date.now() - startTime
          try {
            await prisma.message.create({
              data: {
                question,
                answer: fullResponse,
                sessionId: validSessionId,
                responseTimeMs,
                operatorName,
              },
            })
          } catch {
            // Do not fail the request if logging fails
          }

          controller.close()
        } catch (error) {
          controller.error(error)
        } finally {
          clearTimeout(timeoutId)
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
