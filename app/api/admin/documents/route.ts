import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

// Migrate legacy system_prompt_docs setting to Document table (runs once)
async function migrateLegacyDoc(): Promise<void> {
  try {
    const count = await prisma.document.count()
    if (count > 0) return

    const legacy = await prisma.setting.findUnique({ where: { key: 'system_prompt_docs' } })
    if (!legacy?.value) return

    await prisma.document.create({
      data: {
        name: 'Documento Importado',
        content: legacy.value,
        type: 'txt',
        sizeBytes: Buffer.byteLength(legacy.value, 'utf8'),
        order: 0,
      },
    })
    await prisma.setting.delete({ where: { key: 'system_prompt_docs' } })
  } catch {
    // Non-fatal: migration failure should not block the request
  }
}

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await migrateLegacyDoc()

    const documents = await prisma.document.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        type: true,
        sizeBytes: true,
        active: true,
        order: true,
        createdAt: true,
        embeddingStatus: true,
        category: true,
      },
    })
    return NextResponse.json({ documents })
  } catch (err) {
    console.error('[GET /api/admin/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, content, type, sizeBytes, category } = body as {
      name?: string
      content?: string
      type?: string
      sizeBytes?: number
      category?: string
    }

    if (!name || !content || !type || sizeBytes === undefined) {
      return NextResponse.json({ error: 'name, content, type and sizeBytes are required' }, { status: 400 })
    }

    const manualCategory = (category as string) ?? 'geral'
    let resolvedCategory = manualCategory

    // Only auto-classify if admin left it as 'geral' (didn't manually pick)
    if (manualCategory === 'geral') {
      const VALID_CATEGORIES = [
        'bradesco',
        'agibank',
        'eagle',
        'zurich',
        'geral',
        'processos-internos',
      ]

      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

        const excerpt = content.slice(0, 2000)

        const classifyResponse = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 20,
          messages: [
            {
              role: 'user',
              content: `Você é um classificador de documentos internos da SBK Legal Operations.

Categorias disponíveis:
- bradesco: documentos relacionados ao cliente Bradesco
- agibank: documentos relacionados ao cliente Agibank
- eagle: documentos relacionados ao cliente Eagle
- zurich: documentos relacionados ao cliente Zurich
- processos-internos: manuais, procedimentos e processos internos da SBK
- geral: documentos que se aplicam a múltiplos clientes ou não se encaixam nas categorias acima

Nome do arquivo: ${name}

Trecho do conteúdo:
${excerpt}

Responda APENAS com o id da categoria, sem explicação, sem pontuação. Uma palavra só.`,
            },
          ],
        })

        const suggested =
          classifyResponse.content[0].type === 'text'
            ? classifyResponse.content[0].text.trim().toLowerCase()
            : 'geral'

        if (VALID_CATEGORIES.includes(suggested)) {
          resolvedCategory = suggested
        }
      } catch (err) {
        console.error('[documents/route] Auto-classify failed, using default:', err)
        // Keep resolvedCategory as 'geral'
      }
    }

    const count = await prisma.document.count()
    const document = await prisma.document.create({
      data: { name, content, type, sizeBytes, order: count, category: resolvedCategory },
    })
    const embedUrl = new URL('/api/admin/documents/embed', req.url).toString()
    fetch(embedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({ documentId: document.id }),
    }).catch((err) => {
      console.error('[documents/route] Background embed failed:', err)
    })
    return NextResponse.json({ document }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/admin/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { id, active, order } = body as {
      id?: string
      active?: boolean
      order?: number
    }

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const document = await prisma.document.update({
      where: { id },
      data: {
        ...(active !== undefined && { active }),
        ...(order !== undefined && { order }),
      },
    })
    return NextResponse.json({ document })
  } catch (err) {
    console.error('[PATCH /api/admin/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
    }

    await prisma.document.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/admin/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
