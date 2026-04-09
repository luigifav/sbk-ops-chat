/**
 * Auth utilities using Web Crypto API only.
 * Compatible with both Edge runtime (middleware) and Node.js runtime (API routes).
 */

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generates an HMAC-SHA256 token for the given password and secret.
 * The same password + secret always produces the same token.
 */
export async function generateToken(password: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password))
  return arrayBufferToHex(signature)
}

/**
 * Verifies that a token matches the expected HMAC for the given password and secret.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyToken(
  token: string,
  password: string,
  secret: string
): Promise<boolean> {
  const expected = await generateToken(password, secret)
  if (token.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}
