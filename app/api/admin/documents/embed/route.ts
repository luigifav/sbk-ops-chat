import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { chunkText } from '@/lib/chunking'
import { embedBatch } from '@/lib/embeddings'

export const dynamic = 'force-dynamic'

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let documentId: string | undefined

  try {
    const body = await req.json()
    documentId = body.documentId as string | undefined

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

    const document = await prisma.document.findUnique({ where: { id: documentId } })
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Mark as processing
    await prisma.document.update({
      where: { id: documentId },
      data: { embeddingStatus: 'processing' },
    })

    // Delete existing chunks (re-embed)
    await prisma.documentChunk.deleteMany({ where: { documentId } })

    // Chunk the document
    const chunks = chunkText(document.content)

    if (chunks.length === 0) {
      await prisma.document.update({
        where: { id: documentId },
        data: { embeddingStatus: 'done' },
      })
      return NextResponse.json({ chunksCreated: 0 })
    }

    // Generate embeddings
    const embeddings = await embedBatch(chunks)

    // Insert chunks with embeddings via raw SQL (Prisma doesn't support vector type natively)
    const insertPromises = chunks.map((content, index) => {
      const id = crypto.randomUUID()
      const embedding = embeddings[index]
      const vectorLiteral = `[${embedding.join(',')}]`
      return prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentChunk" ("id", "documentId", "content", "embedding", "chunkIndex", "createdAt")
         VALUES ($1, $2, $3, $4::vector, $5, NOW())`,
        id,
        documentId,
        content,
        vectorLiteral,
        index
      )
    })

    await Promise.all(insertPromises)

    await prisma.document.update({
      where: { id: documentId },
      data: { embeddingStatus: 'done' },
    })

    return NextResponse.json({ chunksCreated: chunks.length })
  } catch (err) {
    console.error('[POST /api/admin/documents/embed]', err)
    if (documentId) {
      await prisma.document.update({
        where: { id: documentId },
        data: { embeddingStatus: 'error' },
      }).catch(() => {})
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
