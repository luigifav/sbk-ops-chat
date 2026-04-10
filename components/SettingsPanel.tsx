'use client'

import { useState, useEffect, useRef } from 'react'

const DEFAULT_CHIPS = [
  'Como funciona o processo X',
  'Onde encontro Y',
  'O que fazer quando Z',
  'Qual o prazo para W',
]

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const SUPPORTED_EXTS = ['txt', 'md', 'pdf', 'docx', 'xls', 'xlsx']

interface DocumentItem {
  id: string
  name: string
  type: string
  sizeBytes: number
  active: boolean
  order: number
  createdAt: string
  embeddingStatus: string   // 'pending' | 'processing' | 'done' | 'error'
}

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

async function parseXlsx(arrayBuffer: ArrayBuffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  return workbook.SheetNames.map((name: string) => {
    const sheet = workbook.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    return `## Aba: ${name}\n${csv}`
  }).join('\n\n')
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function FileIcon({ type }: { type: string }) {
  if (type === 'pdf') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    )
  }
  if (type === 'docx') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    )
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  )
}

function EmbeddingBadge({
  status,
  onIndex,
}: {
  status: string
  onIndex: () => void
}) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        Indexado
      </span>
    )
  }

  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
        Indexando…
      </span>
    )
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onIndex}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
        Erro — tentar novamente
      </button>
    )
  }

  // pending (default)
  return (
    <button
      type="button"
      onClick={onIndex}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 transition-colors"
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
      </svg>
      Indexar
    </button>
  )
}

export default function SettingsPanel() {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [chips, setChips] = useState<string[]>(DEFAULT_CHIPS)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [savingChips, setSavingChips] = useState(false)
  const [chipsMsg, setChipsMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadDocuments() {
    const res = await fetch('/api/admin/documents')
    if (!res.ok) return
    const { documents: docs } = await res.json()
    setDocuments(docs)
  }

  useEffect(() => {
    async function load() {
      try {
        const [, settingsRes] = await Promise.all([
          loadDocuments(),
          fetch('/api/admin/settings'),
        ])
        if (settingsRes.ok) {
          const { settings } = await settingsRes.json()
          for (const s of settings as { key: string; value: string }[]) {
            if (s.key === 'quick_chips') {
              try {
                const parsed = JSON.parse(s.value)
                if (Array.isArray(parsed) && parsed.length > 0) setChips(parsed)
              } catch {}
            }
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
    e.target.value = ''
    if (!file) return

    setFileError(null)

    if (file.size > MAX_FILE_SIZE) {
      setFileError('Arquivo muito grande. Tamanho máximo: 20 MB.')
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!SUPPORTED_EXTS.includes(ext)) {
      setFileError('Tipo de arquivo não suportado. Use PDF, TXT, MD, DOCX, XLS ou XLSX.')
      return
    }

    setUploading(true)
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
      } else if (ext === 'xls' || ext === 'xlsx') {
        const buf = await file.arrayBuffer()
        text = await parseXlsx(buf)
      }

      const res = await fetch('/api/admin/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, content: text, type: ext, sizeBytes: file.size }),
      })

      if (!res.ok) {
        setFileError('Erro ao salvar o documento. Tente novamente.')
        return
      }

      await loadDocuments()
    } catch (err) {
      console.error('File upload error:', err)
      setFileError('Erro ao processar o arquivo. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, active: !current } : d)))
    try {
      await fetch('/api/admin/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !current }),
      })
    } catch {
      // Revert optimistic update on failure
      setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, active: current } : d)))
    }
  }

  async function deleteDocument(id: string) {
    if (!confirm('Remover este documento?')) return
    setDocuments((prev) => prev.filter((d) => d.id !== id))
    try {
      await fetch(`/api/admin/documents?id=${id}`, { method: 'DELETE' })
    } catch {
      // Re-load on failure to restore correct state
      await loadDocuments()
    }
  }

  async function triggerEmbed(id: string) {
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, embeddingStatus: 'processing' } : d))
    )
    try {
      const res = await fetch('/api/admin/documents/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: id }),
      })
      if (res.ok) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, embeddingStatus: 'done' } : d))
        )
      } else {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, embeddingStatus: 'error' } : d))
        )
      }
    } catch {
      setDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, embeddingStatus: 'error' } : d))
      )
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
      {/* Documents */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Documentação operacional</h3>
        <p className="text-sm text-gray-500 mb-4">
          Faça upload dos manuais e documentos internos. Os documentos ativos são injetados no
          system prompt do assistente a cada conversa.
        </p>

        {/* Upload button */}
        <div className="flex items-center gap-2 mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx,.xls,.xlsx"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {uploading ? (
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
          <span className="text-xs text-gray-400">PDF, TXT, MD, DOCX, XLS, XLSX · máx. 20 MB</span>
        </div>

        {fileError && <p className="text-sm text-red-600 mb-3">{fileError}</p>}

        {/* Document list */}
        {documents.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">
            Nenhum documento carregado. Faça upload de um arquivo para usar como contexto do chat.
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <FileIcon type={doc.type} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                    <EmbeddingBadge
                      status={doc.embeddingStatus}
                      onIndex={() => triggerEmbed(doc.id)}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatSize(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                  </p>
                </div>

                {/* Active toggle */}
                <button
                  type="button"
                  onClick={() => toggleActive(doc.id, doc.active)}
                  aria-label={doc.active ? 'Desativar documento' : 'Ativar documento'}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    doc.active ? 'bg-green-500' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
                      doc.active ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => deleteDocument(doc.id)}
                  aria-label="Remover documento"
                  className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
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
              <p className={`text-sm ${chipsMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
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
