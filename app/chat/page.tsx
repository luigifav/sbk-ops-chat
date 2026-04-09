import { prisma } from '@/lib/prisma'
import Chat from '@/components/Chat'

const DEFAULT_CHIPS = [
  'Como funciona o processo X',
  'Onde encontro Y',
  'O que fazer quando Z',
  'Qual o prazo para W',
]

export default async function ChatPage() {
  let chips = DEFAULT_CHIPS

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'quick_chips' },
    })
    if (setting?.value) {
      const parsed = JSON.parse(setting.value)
      if (Array.isArray(parsed) && parsed.length > 0) {
        chips = parsed
      }
    }
  } catch {
    // Use defaults on DB error
  }

  return <Chat chips={chips} />
}
