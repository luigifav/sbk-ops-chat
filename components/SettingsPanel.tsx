'use client'

import { useState, useEffect } from 'react'

const DEFAULT_CHIPS = [
  'Como funciona o processo X',
  'Onde encontro Y',
  'O que fazer quando Z',
  'Qual o prazo para W',
]

export default function SettingsPanel() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [chips, setChips] = useState<string[]>(DEFAULT_CHIPS)
  const [loading, setLoading] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [savingChips, setSavingChips] = useState(false)
  const [promptMsg, setPromptMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [chipsMsg, setChipsMsg] = useState<{ text: string; ok: boolean } | null>(null)

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
