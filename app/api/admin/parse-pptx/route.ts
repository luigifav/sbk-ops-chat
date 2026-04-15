import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { unzipSync } from 'fflate'

export const dynamic = 'force-dynamic'

// NOTE: this server-side route is kept as a fallback for API clients that send
// the raw PPTX bytes.  The main upload UI (SettingsPanel) parses PPTX in the
// browser to stay under Vercel's 4.5 MB serverless body-size limit.

async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  try {
    const adminToken = req.cookies.get('sbk_admin_token')?.value
    if (!adminToken) return false
    return verifyToken(adminToken, process.env.ADMIN_PASSWORD!, process.env.AUTH_SECRET!)
  } catch {
    return false
  }
}

// PPTX = ZIP archive. Text lives in <a:t> DrawingML elements
// inside ppt/slides/slideN.xml entries.
function extractTextFromPptx(buffer: Uint8Array): string {
  const unzipped = unzipSync(buffer)
  const slidePattern = /^ppt\/slides\/slide\d+\.xml$/
  const decoder = new TextDecoder('utf-8')

  const slideTexts = Object.entries(unzipped)
    .filter(([name]) => slidePattern.test(name))
    .sort(([a], [b]) => {
      const n = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? '0', 10)
      return n(a) - n(b)
    })
    .map(([, data]) => {
      const xml = decoder.decode(data)
      return (xml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]*>/g, '').trim())
        .filter(Boolean)
        .join(' ')
    })
    .filter(Boolean)

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

    const buffer = new Uint8Array(await file.arrayBuffer())
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
