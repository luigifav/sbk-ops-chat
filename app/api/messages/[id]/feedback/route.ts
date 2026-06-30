import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authToken = req.cookies.get('sbk_auth_token')?.value
  if (!authToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const isValid = await verifyToken(
    authToken,
    process.env.ACCESS_PASSWORD!,
    process.env.AUTH_SECRET!
  )
  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { feedback } = body as { feedback: unknown }

  if (feedback !== 1 && feedback !== -1 && feedback !== null) {
    return NextResponse.json({ error: 'Invalid feedback value' }, { status: 400 })
  }

  try {
    await prisma.message.update({
      where: { id },
      data: { feedback: feedback as number | null },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
}
