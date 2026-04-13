/**
 * In-memory sliding-window rate limiter.
 *
 * LIMITATION — SECURITY TODO (Production upgrade required):
 * This implementation stores counters in Node.js process memory.
 * In a serverless environment (Vercel Functions) each cold-start or concurrent
 * instance creates a fresh counter, so the effective rate limit can be exceeded
 * when multiple function instances are active simultaneously.
 *
 * Recommended production upgrade:
 *   Replace with Upstash Redis using atomic INCR + EXPIRE operations.
 *   Install:  npm install @upstash/ratelimit @upstash/redis
 *   Docs:     https://github.com/upstash/ratelimit-js
 *   Alt:      Vercel KV (backed by Upstash) — https://vercel.com/docs/storage/vercel-kv
 *
 * For single-instance deployments or low-traffic scenarios this provides a
 * meaningful first line of defence against brute-force attacks.
 */

interface Entry {
  count: number
  windowStart: number
}

const store = new Map<string, Entry>()

// Periodic GC to prevent unbounded memory growth.
// Only runs in long-lived Node.js processes; ignored in Edge runtime.
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const cutoff = Date.now() - 60 * 60 * 1_000 // discard entries older than 1 h
      for (const [k, e] of Array.from(store.entries())) {
        if (e.windowStart < cutoff) store.delete(k)
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

/**
 * Check and increment the counter for `key`.
 *
 * @param key       Unique string identifying the caller + endpoint (e.g. `"auth:1.2.3.4"`)
 * @param limit     Maximum requests allowed within the window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window — reset counter
    store.set(key, { count: 1, windowStart: now })
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
