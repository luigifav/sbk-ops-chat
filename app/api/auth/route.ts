import { NextRequest, NextResponse } from 'next/server'
import { generateToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { operatorName, password } = body as {
      operatorName?: string
      password?: string
    }

    if (!operatorName?.trim() || !password) {
      return NextResponse.json({ error: 'Nome e senha obrigatórios' }, { status: 400 })
    }

    const operator = await prisma.operator.findFirst({
      where: {
        name: { equals: operatorName.trim(), mode: 'insensitive' },
        active: true,
      },
    })

    if (!operator) {
      return NextResponse.json({ error: 'Operador não encontrado ou inativo' }, { status: 401 })
    }

    const passwordMatch = await bcrypt.compare(password, operator.password)
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    // Generate token using ACCESS_PASSWORD so middleware (unchanged) can verify it
    const token = await generateToken(process.env.ACCESS_PASSWORD!, process.env.AUTH_SECRET!)

    const response = NextResponse.json({ success: true })
    response.cookies.set('sbk_auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
      path: '/',
    })
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
