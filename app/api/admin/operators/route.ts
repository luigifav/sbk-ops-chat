import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const operators = await prisma.operator.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, active: true, createdAt: true },
  })

  return NextResponse.json({ operators })
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { name, password } = body as { name?: string; password?: string }

  if (!name?.trim() || !password) {
    return NextResponse.json({ error: 'Nome e senha obrigatórios' }, { status: 400 })
  }

  const existing = await prisma.operator.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
  })

  if (existing) {
    return NextResponse.json({ error: 'Já existe um operador com esse nome' }, { status: 409 })
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  const operator = await prisma.operator.create({
    data: { name: name.trim(), password: hashedPassword },
    select: { id: true, name: true, active: true, createdAt: true },
  })

  return NextResponse.json({ operator }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { id, active, password } = body as {
    id?: string
    active?: boolean
    password?: string
  }

  if (!id) {
    return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  }

  const data: { active?: boolean; password?: string } = {}
  if (active !== undefined) data.active = active
  if (password) data.password = await bcrypt.hash(password, 10)

  const operator = await prisma.operator.update({
    where: { id },
    data,
    select: { id: true, name: true, active: true, createdAt: true },
  })

  return NextResponse.json({ operator })
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  }

  await prisma.operator.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
