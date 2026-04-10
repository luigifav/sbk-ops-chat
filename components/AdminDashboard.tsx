'use client'

import { useState, useEffect, useCallback } from 'react'
import SettingsPanel from './SettingsPanel'
import OperatorsPanel from './OperatorsPanel'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface MessageRecord {
  id: string
  question: string
  answer: string
  sessionId: string
  responseTimeMs: number
  createdAt: string
  operatorName: string
}

interface Stats {
  today: number
  last7days: number
  last30days: number
  total: number
}

type Period = 'today' | '7days' | '30days' | 'all'
type Tab = 'messages' | 'analytics' | 'operators' | 'settings'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7days': '7 dias',
  '30days': '30 dias',
  all: 'Todos',
}

const THEME_COLORS = [
  '#01B2AA',
  '#2A7A6F',
  '#1F3A3A',
  '#4B4B4B',
  '#24262D',
  '#06B6D4',
  '#0891B2',
  '#0E7490',
  '#155E75',
  '#164E63',
]

interface AnalyticsSummary {
  totalMessages: number
  avgResponseMs: number
  uniqueOperators: number
  topTheme: string
}

interface OperatorStat {
  name: string
  total: number
  avgResponseMs: number
}

interface AnalyticsMessage {
  id: string
  question: string
  operatorName: string
  theme: string | null
  createdAt: string
  responseTimeMs: number
}

// Shared SBK icon for admin header
function SbkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sbk-admin-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#01B2AA" />
          <stop offset="100%" stopColor="#1F3A3A" />
        </linearGradient>
      </defs>
      <rect x="1" y="9.5" width="14" height="3.5" rx="1" fill="url(#sbk-admin-g)" opacity="0.4" transform="rotate(-5 8 11.25)" />
      <rect x="1" y="6" width="14" height="3.5" rx="1" fill="url(#sbk-admin-g)" opacity="0.65" transform="rotate(-5 8 7.75)" />
      <rect x="1" y="2.5" width="14" height="3.5" rx="1" fill="url(#sbk-admin-g)" opacity="0.95" />
    </svg>
  )
}

function AnalyticsPanel() {
  type AnalyticsPeriod = 'today' | '7days' | '30days' | 'all'

  const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
    today: 'Hoje',
    '7days': '7 dias',
    '30days': '30 dias',
    all: 'Todos',
  }

  const [period, setPeriod] = useState<AnalyticsPeriod>('30days')
  const [selectedOperator, setSelectedOperator] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [volumeData, setVolumeData] = useState<{ date: string; perguntas: number }[]>([])
  const [themeData, setThemeData] = useState<{ theme: string; count: number }[]>([])
  const [operatorData, setOperatorData] = useState<OperatorStat[]>([])
  const [hourlyData, setHourlyData] = useState<{ hora: string; perguntas: number }[]>([])
  const [operators, setOperators] = useState<{ name: string; total: number }[]>([])
  const [messages, setMessages] = useState<AnalyticsMessage[]>([])

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (selectedOperator) params.set('operator', selectedOperator)
      const res = await fetch(`/api/admin/analytics?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setVolumeData(data.volumeChartData)
        setThemeData(data.themeChartData)
        setOperatorData(data.operatorChartData)
        setHourlyData(data.hourlyChartData)
        setMessages(data.messages)
        setOperators(data.operators)
      }
    } finally {
      setLoading(false)
    }
  }, [period, selectedOperator])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  function handleExportCsv() {
    const params = new URLSearchParams({ period, export: 'csv' })
    if (selectedOperator) params.set('operator', selectedOperator)
    window.location.href = `/api/admin/analytics?${params}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-brand-turquesa/30 border-t-brand-turquesa rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Period pills */}
          <div className="flex gap-1 p-1 rounded-lg bg-brand-gelo border border-brand-verde-escuro/10">
            {(Object.keys(ANALYTICS_PERIOD_LABELS) as AnalyticsPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  period === p
                    ? 'bg-brand-verde-escuro text-white shadow-sm'
                    : 'text-brand-cinza-chumbo hover:text-brand-verde-escuro'
                }`}
              >
                {ANALYTICS_PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Operator filter */}
          <select
            value={selectedOperator}
            onChange={(e) => setSelectedOperator(e.target.value)}
            className="px-3 py-1.5 text-xs border border-brand-verde-escuro/15 rounded-lg bg-white text-brand-verde-escuro focus:outline-none focus:border-brand-turquesa focus:shadow-[0_0_0_3px_rgba(1,178,170,0.1)] transition-all"
          >
            <option value="">Todos os operadores</option>
            {operators.map((op) => (
              <option key={op.name ?? 'anon'} value={op.name ?? ''}>
                {op.name ?? 'Anônimo'} ({op.total})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border-[1.5px] border-brand-verde-escuro text-brand-verde-escuro rounded-lg hover:bg-brand-verde-escuro hover:text-white transition-all"
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

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Perguntas', value: summary.totalMessages.toLocaleString('pt-BR') },
            { label: 'Tempo médio', value: `${(summary.avgResponseMs / 1000).toFixed(1)}s` },
            { label: 'Operadores', value: summary.uniqueOperators },
            { label: 'Tema mais comum', value: summary.topTheme },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl border-l-[3px] border-l-brand-turquesa hover:border-l-brand-verde-escuro p-4 transition-all duration-200 cursor-default"
            >
              <p className="text-[11px] text-brand-cinza-chumbo uppercase tracking-[0.08em] mb-2">{card.label}</p>
              <p className="text-lg font-semibold text-brand-verde-escuro truncate">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Volume over time */}
      <div className="bg-white rounded-xl border border-brand-verde-escuro/[0.06] p-5">
        <h3 className="text-sm font-semibold text-brand-verde-escuro mb-4">Volume de perguntas por dia</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={volumeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#4B4B4B' }} />
            <YAxis tick={{ fontSize: 11, fill: '#4B4B4B' }} allowDecimals={false} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="perguntas"
              stroke="#01B2AA"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Theme + Hourly side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-brand-verde-escuro/[0.06] p-5">
          <h3 className="text-sm font-semibold text-brand-verde-escuro mb-4">Perguntas por tema</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={themeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#4B4B4B' }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="theme"
                tick={{ fontSize: 10, fill: '#4B4B4B' }}
                width={120}
              />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {themeData.map((_, index) => (
                  <Cell key={index} fill={THEME_COLORS[index % THEME_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-brand-verde-escuro/[0.06] p-5">
          <h3 className="text-sm font-semibold text-brand-verde-escuro mb-4">Horário de pico</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" />
              <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#4B4B4B' }} interval={3} />
              <YAxis tick={{ fontSize: 11, fill: '#4B4B4B' }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="perguntas" fill="#2A7A6F" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Operator ranking */}
      <div className="bg-white rounded-xl border border-brand-verde-escuro/[0.06] p-5">
        <h3 className="text-sm font-semibold text-brand-verde-escuro mb-4">Atividade por operador</h3>
        <ResponsiveContainer width="100%" height={Math.max(operatorData.length * 40, 120)}>
          <BarChart data={operatorData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#4B4B4B' }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#4B4B4B' }} width={100} />
            <Tooltip
              formatter={(value, name) =>
                name === 'total'
                  ? [`${value} perguntas`, 'Total']
                  : [`${value}ms`, 'Tempo médio']
              }
            />
            <Bar dataKey="total" fill="#01B2AA" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent messages table */}
      <div className="bg-white rounded-xl border border-brand-verde-escuro/[0.06] p-5">
        <h3 className="text-sm font-semibold text-brand-verde-escuro mb-4">
          Perguntas recentes
          {selectedOperator && (
            <span className="ml-2 text-xs font-normal text-brand-cinza-chumbo">— {selectedOperator}</span>
          )}
        </h3>
        {messages.length === 0 ? (
          <p className="text-sm text-brand-cinza-chumbo text-center py-6">Nenhuma pergunta encontrada.</p>
        ) : (
          <div className="space-y-2">
            {messages.slice(0, 50).map((msg) => (
              <div
                key={msg.id}
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-brand-gelo transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-brand-verde-escuro truncate">{msg.question}</p>
                  <p className="text-xs text-brand-cinza-chumbo mt-0.5">
                    <span className="font-medium text-brand-cinza-chumbo">
                      {msg.operatorName ?? 'Anônimo'}
                    </span>
                    {' · '}
                    {msg.theme && (
                      <>
                        <span className="text-brand-turquesa">{msg.theme}</span>
                        {' · '}
                      </>
                    )}
                    {new Date(msg.createdAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <span className="text-xs text-brand-cinza-chumbo font-mono shrink-0">
                  {msg.responseTimeMs}ms
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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

  const TAB_LABELS: Record<Tab, string> = {
    messages: 'Mensagens',
    analytics: 'Analytics',
    operators: 'Operadores',
    settings: 'Configurações',
  }

  return (
    <div className="min-h-screen bg-brand-gelo">
      {/* ── Header ── */}
      <header
        className="bg-brand-verde-escuro border-b-2 border-brand-turquesa px-6 flex-shrink-0"
        style={{ height: '56px' }}
      >
        <div className="max-w-6xl mx-auto h-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <SbkIcon />
            <div>
              <h1 className="text-sm font-semibold text-white leading-none">SBK Operacional</h1>
              <p className="text-[11px] text-brand-turquesa mt-0.5">Painel administrativo</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/chat"
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              Ir para chat
            </a>
            <button
              onClick={handleLogout}
              className="text-xs text-white/60 hover:text-white transition-colors"
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
              className="bg-white rounded-xl border-l-[3px] border-l-brand-turquesa hover:border-l-brand-verde-escuro p-4 transition-all duration-200 cursor-default"
            >
              <p className="text-[11px] text-brand-cinza-chumbo uppercase tracking-[0.08em] mb-2">{stat.label}</p>
              <p className="text-[28px] font-semibold text-brand-verde-escuro leading-none">
                {stat.value.toLocaleString('pt-BR')}
              </p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="border-b border-brand-verde-escuro/10 mb-6">
          <div className="flex gap-6">
            {(['messages', 'analytics', 'operators', 'settings'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-all ${
                  activeTab === tab
                    ? 'border-brand-turquesa text-brand-verde-escuro font-semibold'
                    : 'border-transparent text-brand-cinza-chumbo hover:text-brand-verde-escuro'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>

        {/* Messages Tab */}
        {activeTab === 'messages' && (
          <div>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              {/* Period filter pills */}
              <div className="flex gap-1 p-1 rounded-lg bg-white border border-brand-verde-escuro/10">
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      period === p
                        ? 'bg-brand-verde-escuro text-white shadow-sm'
                        : 'text-brand-cinza-chumbo hover:text-brand-verde-escuro'
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
                className="flex-1 min-w-48 px-3 py-1.5 text-sm border border-brand-verde-escuro/15 rounded-lg bg-white text-brand-verde-escuro placeholder:text-brand-cinza-chumbo/50 focus:outline-none focus:border-brand-turquesa focus:shadow-[0_0_0_3px_rgba(1,178,170,0.1)] transition-all"
              />

              {/* Export */}
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border-[1.5px] border-brand-verde-escuro text-brand-verde-escuro rounded-lg hover:bg-brand-verde-escuro hover:text-white transition-all whitespace-nowrap"
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
                <div className="w-6 h-6 border-2 border-brand-turquesa/30 border-t-brand-turquesa rounded-full animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-16 text-sm text-brand-cinza-chumbo">
                Nenhuma mensagem encontrada.
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="bg-white rounded-[10px] border border-brand-verde-escuro/[0.06] overflow-hidden hover:border-brand-turquesa/20 hover:bg-[#F8F9FB] transition-all"
                  >
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === msg.id ? null : msg.id)
                      }
                      className="w-full text-left px-4 py-3 flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-verde-escuro truncate">
                          {msg.question}
                        </p>
                        <p className="text-xs text-brand-cinza-chumbo mt-0.5">
                          <span className="font-medium">{msg.operatorName}</span>
                          {' · '}
                          {formatDate(msg.createdAt)}
                          {' · '}
                          <span className="font-mono">{msg.responseTimeMs}ms</span>
                        </p>
                      </div>
                      <svg
                        className={`w-4 h-4 text-brand-cinza-chumbo flex-shrink-0 mt-0.5 transition-transform duration-200 ${
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
                      <div className="px-4 pb-4 border-t border-brand-verde-escuro/[0.06]">
                        <div className="mt-3">
                          <p className="text-xs font-medium text-brand-cinza-chumbo mb-1.5">
                            Pergunta
                          </p>
                          <p className="text-sm text-brand-verde-escuro bg-brand-gelo rounded-lg px-3 py-2 whitespace-pre-wrap">
                            {msg.question}
                          </p>
                        </div>
                        <div className="mt-3">
                          <p className="text-xs font-medium text-brand-cinza-chumbo mb-1.5">
                            Resposta
                          </p>
                          <p className="text-sm text-brand-verde-escuro bg-brand-gelo rounded-lg px-3 py-2 whitespace-pre-wrap">
                            {msg.answer}
                          </p>
                        </div>
                        <p className="text-xs text-brand-cinza-chumbo mt-2">
                          <span className="font-medium">Operador:</span> {msg.operatorName}
                          {' · '}
                          <span className="font-mono">Session: {msg.sessionId}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Operators Tab */}
        {activeTab === 'operators' && <OperatorsPanel />}

        {/* Settings Tab */}
        {activeTab === 'settings' && <SettingsPanel />}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && <AnalyticsPanel />}
      </div>
    </div>
  )
}
