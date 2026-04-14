import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import officeParser from 'officeparser'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'

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

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    // Write to a temp file with .pptx extension so officeparser detects the
    // type from the extension (avoiding a dynamic import of file-type v21 ESM
    // which fails in the Next.js / Vercel serverless environment).
    const buffer = Buffer.from(await file.arrayBuffer())
    const tmpPath = join(tmpdir(), `${randomUUID()}.pptx`)
    try {
      await writeFile(tmpPath, buffer)
      const ast = await officeParser.parseOffice(tmpPath)
      const text = ast.toText()
      return NextResponse.json({ text })
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/admin/parse-pptx]', err)
    return NextResponse.json({ error: `Failed to parse PPTX file: ${message}` }, { status: 500 })
  }
}
