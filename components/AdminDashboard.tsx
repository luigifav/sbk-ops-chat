'use client'

import { useState, useEffect, useCallback } from 'react'
import SettingsPanel from './SettingsPanel'

interface MessageRecord {
  id: string
  question: string
  answer: string
  sessionId: string
  responseTimeMs: number
  createdAt: string
}

interface Stats {
  today: number
  last7days: number
  last30days: number
  total: number
}

type Period = 'today' | '7days' | '30days' | 'all'
type Tab = 'messages' | 'settings'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7days': '7 dias',
  '30days': '30 dias',
  all: 'Todos',
}

export default function AdminDashboard() {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [stats, setStats] = useState<Stats>({ today: 0, last7days: 0, last30days: 0, total: 0 })
  const [period, setPeriod] = useState<Period>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('messages')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/admin/messages?${params}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages)
        setStats(data.stats)
      }
    } finally {
      setLoading(false)
    }
  }, [period, debouncedSearch])

  useEffect(() => {
    if (activeTab === 'messages') {
      fetchData()
    }
  }, [fetchData, activeTab])

  function handleExportCsv() {
    const params = new URLSearchParams({ period, export: 'csv' })
    if (debouncedSearch) params.set('search', debouncedSearch)
    window.location.href = `/api/admin/messages?${params}`
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' })
    window.location.href = '/'
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-xs font-bold">
              SBK
            </div>
            <h1 className="font-semibold text-gray-900">Admin</h1>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/chat"
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Ir para chat
            </a>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Hoje', value: stats.today },
            { label: '7 dias', value: stats.last7days },
            { label: '30 dias', value: stats.last30days },
            { label: 'Total', value: stats.total },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-xl border border-gray-100 p-4"
            >
              <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900">
                {stat.value.toLocaleString('pt-BR')}
              </p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <div className="flex gap-6">
            {(['messages', 'settings'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'messages' ? 'Mensagens' : 'Configurações'}
              </button>
            ))}
          </div>
        </div>

        {/* Messages Tab */}
        {activeTab === 'messages' && (
          <div>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              {/* Period filter */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      period === p
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>

              {/* Search */}
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nas perguntas..."
                className="flex-1 min-w-48 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />

              {/* Export */}
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Exportar CSV
              </button>
            </div>

            {/* Messages list */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-16 text-sm text-gray-400">
                Nenhuma mensagem encontrada.
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="bg-white rounded-xl border border-gray-100 overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === msg.id ? null : msg.id)
                      }
                      className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {msg.question}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatDate(msg.createdAt)} ·{' '}
                          <span className="font-mono">{msg.responseTimeMs}ms</span>
                        </p>
                      </div>
                      <svg
                        className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${
                          expandedId === msg.id ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    {expandedId === msg.id && (
                      <div className="px-4 pb-4 border-t border-gray-100">
                        <div className="mt-3">
                          <p className="text-xs font-medium text-gray-500 mb-1.5">
                            Pergunta
                          </p>
                          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 whitespace-pre-wrap">
                            {msg.question}
                          </p>
                        </div>
                        <div className="mt-3">
                          <p className="text-xs font-medium text-gray-500 mb-1.5">
                            Resposta
                          </p>
                          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 whitespace-pre-wrap">
                            {msg.answer}
                          </p>
                        </div>
                        <p className="text-xs text-gray-400 mt-2 font-mono">
                          Session: {msg.sessionId}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  )
}
