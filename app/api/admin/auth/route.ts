import { NextRequest, NextResponse } from 'next/server'
import { generateToken } from '@/lib/auth'
import { checkRateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

// Stricter limit for admin endpoint: 5 attempts per 60 seconds per IP
const ADMIN_LOGIN_LIMIT = 5
const ADMIN_LOGIN_WINDOW = 60 * 1_000

// Limit password input size to prevent DoS via large payloads
const MAX_PASSWORD_LENGTH = 128

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  try {
    // Rate-limit admin login attempts by IP
    const ip = getClientIp(req)
    const rl = checkRateLimit(`admin-login:${ip}`, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em alguns instantes.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1_000)) },
        }
      )
    }

    const body = await req.json()
    const { password } = body as { password?: string }

    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      // Do NOT echo the submitted password back in the response
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    // SECURITY NOTE: ADMIN_PASSWORD is compared as a plain string here because
    // the admin credential is a shared environment-variable secret (not a
    // per-user hashed password).  The rate limit above is the primary defence
    // against brute-force.  If bcrypt hashing of the admin password is desired,
    // store a bcrypt hash in ADMIN_PASSWORD_HASH and compare with bcrypt.compare().
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    const token = await generateToken(password, process.env.AUTH_SECRET!)

    const response = NextResponse.json({ success: true })
    response.cookies.set('sbk_admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.set('sbk_admin_token', '', { maxAge: 0, path: '/' })
  return response
}
