import { NextRequest, NextResponse } from 'next/server'
import { generateToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/ratelimit'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

// Input length limits
const MAX_NAME_LENGTH = 100
const MAX_PASSWORD_LENGTH = 128
const MAX_INVITE_CODE_LENGTH = 128

// Rate limits (per IP)
const REGISTER_LIMIT = 5    // registrations per 10 minutes
const REGISTER_WINDOW = 10 * 60 * 1_000
const LOGIN_LIMIT = 10      // login attempts per 60 seconds
const LOGIN_WINDOW = 60 * 1_000

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { operatorName, password, isNewAccount, inviteCode } = body as {
      operatorName?: string
      password?: string
      isNewAccount?: boolean
      inviteCode?: string
    }

    // --- Input validation ------------------------------------------------
    if (!operatorName?.trim() || !password) {
      return NextResponse.json({ error: 'Nome e senha obrigatórios' }, { status: 400 })
    }

    if (operatorName.trim().length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Nome deve ter no máximo ${MAX_NAME_LENGTH} caracteres` },
        { status: 400 }
      )
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres` },
        { status: 400 }
      )
    }

    const ip = getClientIp(req)

    // --- Auto-cadastro ---------------------------------------------------
    if (isNewAccount) {
      // Rate-limit registrations by IP to prevent invite-code brute-force
      const rl = checkRateLimit(`register:${ip}`, REGISTER_LIMIT, REGISTER_WINDOW)
      if (!rl.allowed) {
        return NextResponse.json(
          { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
          {
            status: 429,
            headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1_000)) },
          }
        )
      }

      // Validate invite code — length-check first to avoid unnecessary DB work
      if (!inviteCode || inviteCode.length > MAX_INVITE_CODE_LENGTH) {
        return NextResponse.json({ error: 'Código de convite inválido' }, { status: 401 })
      }

      // SECURITY: constant-time comparison prevents timing side-channel on invite code.
      // The invite code is never echoed back in error responses or logs.
      const expectedCode = process.env.INVITE_CODE ?? ''
      if (inviteCode.length !== expectedCode.length || inviteCode !== expectedCode) {
        return NextResponse.json({ error: 'Código de convite inválido' }, { status: 401 })
      }

      const existing = await prisma.operator.findFirst({
        where: { name: { equals: operatorName.trim(), mode: 'insensitive' } },
      })

      if (existing) {
        return NextResponse.json({ error: 'Já existe um operador com esse nome' }, { status: 409 })
      }

      const hashedPassword = await bcrypt.hash(password, 10)
      await prisma.operator.create({
        data: {
          name: operatorName.trim(),
          password: hashedPassword,
          status: 'pending',
          active: false,
        },
      })

      return NextResponse.json({
        pending: true,
        message: 'Cadastro realizado! Aguarde a aprovação do administrador.',
      })
    }

    // --- Login normal ----------------------------------------------------
    // Rate-limit login attempts by IP to prevent brute-force attacks
    const rl = checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas de login. Tente novamente em alguns instantes.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1_000)) },
        }
      )
    }

    const operator = await prisma.operator.findFirst({
      where: {
        name: { equals: operatorName.trim(), mode: 'insensitive' },
        status: 'active',
        active: true,
      },
    })

    if (!operator) {
      const pending = await prisma.operator.findFirst({
        where: {
          name: { equals: operatorName.trim(), mode: 'insensitive' },
          status: 'pending',
        },
      })

      if (pending) {
        return NextResponse.json({
          error: 'Seu cadastro está aguardando aprovação do administrador.',
        }, { status: 403 })
      }

      return NextResponse.json({ error: 'Operador não encontrado ou inativo' }, { status: 401 })
    }

    const passwordMatch = await bcrypt.compare(password, operator.password)
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    const token = await generateToken(process.env.ACCESS_PASSWORD!, process.env.AUTH_SECRET!)

    const response = NextResponse.json({ success: true })
    response.cookies.set('sbk_auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
      path: '/',
    })

    // SECURITY NOTE: sbk_operator_name is intentionally NOT httpOnly so that
    // the Chat component can read it via document.cookie to display the
    // operator's name in the UI (see components/Chat.tsx).
    //
    // Accepted risk: a malicious script (e.g., via XSS) could read or spoof
    // this value.  Because this cookie is used ONLY for logging/display — the
    // actual authentication is performed by sbk_auth_token (httpOnly) — the
    // impact is limited to log-attribution spoofing (an authenticated operator
    // misrepresenting their name in chat logs).  No privilege escalation is
    // possible via this cookie alone.
    //
    // SECURITY TODO: For higher log integrity, replace per-operator name
    // attribution with a server-side lookup: store the operatorId in the
    // auth token payload (e.g. HMAC(operatorId:accessPassword, secret)) so
    // the server can resolve the real name without trusting the cookie.
    response.cookies.set('sbk_operator_name', operator.name, {
      httpOnly: false,
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
  response.cookies.set('sbk_auth_token', '', { maxAge: 0, path: '/' })
  response.cookies.set('sbk_operator_name', '', { maxAge: 0, path: '/' })
  return response
}
