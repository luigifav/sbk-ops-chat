import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import AdmZip from 'adm-zip'

export const dynamic = 'force-dynamic'

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const adminToken = req.cookies.get('sbk_admin_token')?.value
  if (!adminToken) return false
  return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
}

// PPTX files are ZIP archives containing DrawingML XML.
// Text lives in <a:t> elements inside ppt/slides/slideN.xml files.
// This avoids the officeparser/file-type ESM incompatibility in Next.js serverless.
function extractTextFromPptx(buffer: Buffer): string {
  const zip = new AdmZip(buffer)
  const slidePattern = /^ppt\/slides\/slide\d+\.xml$/

  const slideEntries = zip
    .getEntries()
    .filter((entry) => slidePattern.test(entry.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/\d+/)?.[0] ?? '0', 10)
      const numB = parseInt(b.entryName.match(/\d+/)?.[0] ?? '0', 10)
      return numA - numB
    })

  const slideTexts: string[] = []

  for (const entry of slideEntries) {
    const xml = entry.getData().toString('utf-8')
    const textMatches = xml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) ?? []
    const slideText = textMatches
      .map((t) => t.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
      .join(' ')
    if (slideText.trim()) slideTexts.push(slideText.trim())
  }

  return slideTexts.join('\n\n')
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
    const text = extractTextFromPptx(buffer)

    if (!text.trim()) {
      return NextResponse.json(
        {
          error:
            'Não foi possível extrair texto deste arquivo PPTX. Verifique se o arquivo contém texto (não apenas imagens).',
        },
        { status: 422 }
      )
    }

    return NextResponse.json({ text })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/admin/parse-pptx]', err)
    return NextResponse.json(
      { error: `Falha ao processar o arquivo PPTX: ${message}` },
      { status: 500 }
    )
  }
}
