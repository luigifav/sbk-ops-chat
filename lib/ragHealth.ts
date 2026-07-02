import { Redis } from '@upstash/redis'

/**
 * Monitora a taxa de fallback do RAG em janelas fixas de 15 minutos,
 * reaproveitando o Redis do rate limiter (Upstash). Quando a taxa de
 * fallback ultrapassa o limiar dentro de uma janela, emite um alerta
 * estruturado uma única vez por janela (e, se configurado, um webhook).
 *
 * Sem Redis configurado (ex: dev local), a função não faz nada — a
 * visibilidade fica só nos logs estruturados por requisição em
 * app/api/chat/route.ts e no dashboard de analytics.
 */

const redisUrl = process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null

const WINDOW_MS = 15 * 60 * 1_000
const MIN_SAMPLE = 15
const FALLBACK_RATE_THRESHOLD = 0.7

async function sendAlert(fallbackCount: number, total: number): Promise<void> {
  const rate = fallbackCount / total
  const message = `[rag-health] ALERTA: taxa de fallback do RAG em ${(rate * 100).toFixed(0)}% (${fallbackCount}/${total}) nos últimos 15 min.`
  console.error(message)

  const webhookUrl = process.env.RAG_ALERT_WEBHOOK_URL
  if (!webhookUrl) return

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch (err) {
    console.warn('[rag-health] Falha ao enviar webhook de alerta:', err)
  }
}

/**
 * Registra o desfecho (RAG ou fallback) de uma interação e dispara um
 * alerta se a taxa de fallback da janela atual ultrapassar o limiar.
 * Fire-and-forget: nunca deve bloquear ou derrubar a requisição de chat.
 */
export async function recordRagOutcome(usedFallback: boolean): Promise<void> {
  if (!redis) return

  try {
    const bucket = Math.floor(Date.now() / WINDOW_MS)
    const totalKey = `rag-health:total:${bucket}`
    const fallbackKey = `rag-health:fallback:${bucket}`
    const alertedKey = `rag-health:alerted:${bucket}`

    const total = await redis.incr(totalKey)
    if (total === 1) await redis.pexpire(totalKey, WINDOW_MS)

    let fallbackCount = 0
    if (usedFallback) {
      fallbackCount = await redis.incr(fallbackKey)
      if (fallbackCount === 1) await redis.pexpire(fallbackKey, WINDOW_MS)
    } else {
      fallbackCount = Number((await redis.get(fallbackKey)) ?? 0)
    }

    if (total >= MIN_SAMPLE && fallbackCount / total >= FALLBACK_RATE_THRESHOLD) {
      // Lock por janela via SET NX: só quem conseguir gravar a chave dispara
      // o alerta — evita reenviar a cada mensagem enquanto a taxa se mantém alta.
      const acquired = await redis.set(alertedKey, '1', { nx: true, px: WINDOW_MS })
      if (acquired) {
        await sendAlert(fallbackCount, total)
      }
    }
  } catch (err) {
    console.warn('[rag-health] Falha ao registrar métrica de saúde do RAG:', err)
  }
}
