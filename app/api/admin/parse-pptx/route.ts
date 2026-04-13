import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import officeParser from 'officeparser'

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

    const buffer = Buffer.from(await file.arrayBuffer())
    const ast = await officeParser.parseOffice(buffer)
    const text = ast.toText()
    return NextResponse.json({ text })
  } catch (err) {
    console.error('[POST /api/admin/parse-pptx]', err)
    return NextResponse.json({ error: 'Failed to parse PPTX file' }, { status: 500 })
  }
}
