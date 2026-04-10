import { NextRequest, NextResponse } from 'next/server'
import { generateToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { password, operatorName } = body as {
      password?: string
      operatorName?: string
    }

    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }

    if (!operatorName?.trim()) {
      return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
    }

    if (password !== process.env.ACCESS_PASSWORD) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    const token = await generateToken(password, process.env.AUTH_SECRET!)

    const response = NextResponse.json({ success: true })
    response.cookies.set('sbk_auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
      path: '/',
    })
    response.cookies.set('sbk_operator_name', operatorName.trim(), {
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
