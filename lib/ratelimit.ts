import { Redis } from '@upstash/redis'

/**
 * Sliding-window-by-fixed-window rate limiter.
 *
 * Uses Upstash Redis (atomic INCR + PEXPIRE) when
 * UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are configured, so the
 * limit is enforced correctly across concurrent serverless instances.
 *
 * Falls back to an in-memory Map when Redis isn't configured (e.g. local
 * dev) or on a Redis error, so the app degrades instead of failing closed.
 * The in-memory fallback has the known limitation that each serverless
 * instance keeps its own counter — do not rely on it in production.
 */

const redisUrl = process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null

if (!redis) {
  console.warn(
    '[ratelimit] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN não configurados — ' +
      'usando limitador em memória (não confiável em múltiplas instâncias serverless).'
  )
}

interface Entry {
  count: number
  windowStart: number
  /**
   * Duração da janela desta chave, em ms. Guardada por entrada porque o mesmo
   * store atende janelas de tamanhos diferentes: o teto horário do chat usa 1 h
   * e o teto diário usa 24 h sobre uma chave derivada da mesma origem.
   */
  windowMs: number
}

const store = new Map<string, Entry>()

// GC periódico, para o store não crescer sem limite. Só roda em processo Node
// de vida longa; no runtime Edge não há setInterval e o bloco é ignorado.
//
// O corte é por janela DA PRÓPRIA ENTRADA, não por um prazo fixo. Antes ele
// descartava tudo com mais de 1 h, o que apagava a entrada do teto diário, cuja
// janela é de 24 h: o contador de 250 mensagens por dia se reiniciava sozinho a
// cada hora e nunca era alcançado. Sem Redis, o teto efetivo virava o horário
// (60/h x 24 = 1.440 mensagens por operador por dia), ordens de magnitude acima
// do que o limite diário existe para permitir. Uma entrada só pode ser
// descartada depois que a janela dela expira, senão o descarte é o próprio
// bypass do limite.
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Date.now()
      for (const [k, e] of Array.from(store.entries())) {
        if (now - e.windowStart >= e.windowMs) store.delete(k)
      }
    },
    5 * 60 * 1_000
  )
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // epoch ms when the current window resets
}

function checkRateLimitMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window — reset counter
    store.set(key, { count: 1, windowStart: now, windowMs })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + windowMs,
    }
  }

  entry.count++
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.windowStart + windowMs,
  }
}

async function checkRateLimitRedis(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`
  const count = await redis!.incr(redisKey)
  if (count === 1) {
    await redis!.pexpire(redisKey, windowMs)
  }
  const ttlMs = await redis!.pttl(redisKey)
  const resetAt = Date.now() + (ttlMs > 0 ? ttlMs : windowMs)

  if (count > limit) {
    return { allowed: false, remaining: 0, resetAt }
  }
  return { allowed: true, remaining: Math.max(0, limit - count), resetAt }
}

/**
 * Check and increment the counter for `key`.
 *
 * @param key       Unique string identifying the caller + endpoint (e.g. `"auth:1.2.3.4"`)
 * @param limit     Maximum requests allowed within the window
 * @param windowMs  Window duration in milliseconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (redis) {
    try {
      return await checkRateLimitRedis(key, limit, windowMs)
    } catch (err) {
      console.warn('[ratelimit] Falha no Redis, usando fallback em memória:', err)
      return checkRateLimitMemory(key, limit, windowMs)
    }
  }
  return checkRateLimitMemory(key, limit, windowMs)
}
