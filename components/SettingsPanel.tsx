'use client'

import { useState, useEffect, useRef } from 'react'

const DEFAULT_CHIPS = [
  'Como funciona o processo X',
  'Onde encontro Y',
  'O que fazer quando Z',
  'Qual o prazo para W',
]

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const SUPPORTED_EXTS = ['txt', 'md', 'pdf', 'docx']

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const pageTexts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
    pageTexts.push(text)
  }
  return pageTexts.join('\n\n')
}

async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

export default function SettingsPanel() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [chips, setChips] = useState<string[]>(DEFAULT_CHIPS)
  const [loading, setLoading] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [savingChips, setSavingChips] = useState(false)
  const [promptMsg, setPromptMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [chipsMsg, setChipsMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/settings')
        if (!res.ok) return
        const { settings } = await res.json()
        for (const s of settings as { key: string; value: string }[]) {
          if (s.key === 'system_prompt_docs') setSystemPrompt(s.value)
          if (s.key === 'quick_chips') {
            try {
              const parsed = JSON.parse(s.value)
              if (Array.isArray(parsed) && parsed.length > 0) setChips(parsed)
            } catch {}
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function saveSystemPrompt() {
    setSavingPrompt(true)
    setPromptMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'system_prompt_docs', value: systemPrompt }),
      })
      setPromptMsg({ text: res.ok ? 'Salvo com sucesso!' : 'Erro ao salvar.', ok: res.ok })
    } catch {
      setPromptMsg({ text: 'Erro ao salvar.', ok: false })
    } finally {
      setSavingPrompt(false)
      setTimeout(() => setPromptMsg(null), 3000)
    }
  }

  async function saveChips() {
    setSavingChips(true)
    setChipsMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'quick_chips', value: JSON.stringify(chips) }),
      })
      setChipsMsg({ text: res.ok ? 'Salvo com sucesso!' : 'Erro ao salvar.', ok: res.ok })
    } catch {
      setChipsMsg({ text: 'Erro ao salvar.', ok: false })
    } finally {
      setSavingChips(false)
      setTimeout(() => setChipsMsg(null), 3000)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset input so the same file can be re-selected after an error
    e.target.value = ''
    if (!file) return

    setFileError(null)

    if (file.size > MAX_FILE_SIZE) {
      setFileError('Arquivo muito grande. Tamanho máximo: 5 MB.')
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!SUPPORTED_EXTS.includes(ext)) {
      setFileError('Tipo de arquivo não suportado. Use PDF, TXT, MD ou DOCX.')
      return
    }

    setFileLoading(true)
    try {
      let text = ''
      if (ext === 'txt' || ext === 'md') {
        text = await readAsText(file)
      } else if (ext === 'pdf') {
        const buf = await file.arrayBuffer()
        text = await parsePdf(buf)
      } else if (ext === 'docx') {
        const buf = await file.arrayBuffer()
        text = await parseDocx(buf)
      }
      setSystemPrompt(text)
    } catch (err) {
      console.error('File parse error:', err)
      setFileError('Erro ao processar o arquivo. Tente novamente.')
    } finally {
      setFileLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* System Prompt */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Documentação operacional</h3>
        <p className="text-sm text-gray-500 mb-4">
          Cole aqui o manual ou documentação interna. Este conteúdo é injetado no system
          prompt do assistente a cada conversa.
        </p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={14}
          placeholder="Cole aqui a documentação operacional da SBK..."
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
        />

        {/* File upload */}
        <div className="flex items-center gap-2 mt-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {fileLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                Processando…
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-3.5 h-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Carregar arquivo
              </>
            )}
          </button>
          <span className="text-xs text-gray-400">PDF, TXT, MD, DOCX · máx. 5 MB</span>
        </div>
        {fileError && (
          <p className="text-sm text-red-600 mt-1">{fileError}</p>
        )}

        <div className="flex items-center justify-between mt-3">
          <div>
            {promptMsg && (
              <p
                className={`text-sm ${
                  promptMsg.ok ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {promptMsg.text}
              </p>
            )}
          </div>
          <button
            onClick={saveSystemPrompt}
            disabled={savingPrompt}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {savingPrompt ? 'Salvando...' : 'Salvar documentação'}
          </button>
        </div>
      </div>

      {/* Quick Chips */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Sugestões rápidas</h3>
        <p className="text-sm text-gray-500 mb-4">
          Configure as perguntas sugeridas exibidas na tela inicial do chat.
        </p>
        <div className="space-y-2">
          {chips.map((chip, i) => (
            <input
              key={i}
              type="text"
              value={chip}
              onChange={(e) => {
                const updated = [...chips]
                updated[i] = e.target.value
                setChips(updated)
              }}
              placeholder={`Sugestão ${i + 1}`}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <div>
            {chipsMsg && (
              <p
                className={`text-sm ${
                  chipsMsg.ok ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {chipsMsg.text}
              </p>
            )}
          </div>
          <button
            onClick={saveChips}
            disabled={savingChips}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {savingChips ? 'Salvando...' : 'Salvar sugestões'}
          </button>
        </div>
      </div>
    </div>
  )
}
