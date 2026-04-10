import { NextRequest, NextResponse } from 'next/server'
import { generateToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { operatorName, password, isNewAccount, inviteCode } = body as {
      operatorName?: string
      password?: string
      isNewAccount?: boolean
      inviteCode?: string
    }

    if (!operatorName?.trim() || !password) {
      return NextResponse.json({ error: 'Nome e senha obrigatórios' }, { status: 400 })
    }

    // Auto-cadastro
    if (isNewAccount) {
      if (!inviteCode || inviteCode !== process.env.INVITE_CODE) {
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

    // Login normal
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
