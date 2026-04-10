'use client'

import { useState, useEffect } from 'react'

interface OperatorItem {
  id: string
  name: string
  active: boolean
  status: string
  createdAt: string
}

export default function OperatorsPanel() {
  const [operators, setOperators] = useState<OperatorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetting, setResetting] = useState(false)

  async function loadOperators() {
    const res = await fetch('/api/admin/operators')
    if (res.ok) {
      const { operators: ops } = await res.json()
      setOperators(ops)
    }
    setLoading(false)
  }

  useEffect(() => { loadOperators() }, [])

  async function handleCreate() {
    if (!newName.trim() || !newPassword) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erro ao criar operador'); return }
      setNewName('')
      setNewPassword('')
      await loadOperators()
    } finally {
      setCreating(false)
    }
  }

  async function approveOperator(id: string) {
    setOperators((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: 'active', active: true } : o))
    )
    await fetch('/api/admin/operators', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'active', active: true }),
    })
  }

  async function toggleActive(id: string, current: boolean) {
    setOperators((prev) =>
      prev.map((o) => (o.id === id ? { ...o, active: !current, status: !current ? 'active' : 'inactive' } : o))
    )
    await fetch('/api/admin/operators', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !current, status: !current ? 'active' : 'inactive' }),
    })
  }

  async function handleResetPassword(id: string) {
    if (!resetPassword) return
    setResetting(true)
    try {
      await fetch('/api/admin/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password: resetPassword }),
      })
      setResetId(null)
      setResetPassword('')
    } finally {
      setResetting(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remover operador "${name}"?`)) return
    setOperators((prev) => prev.filter((o) => o.id !== id))
    await fetch(`/api/admin/operators?id=${id}`, { method: 'DELETE' })
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  const pending = operators.filter((o) => o.status === 'pending')
  const active = operators.filter((o) => o.status === 'active')
  const inactive = operators.filter((o) => o.status === 'inactive')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <h3 className="font-semibold text-yellow-800 mb-3">
            Aguardando aprovação ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((op) => (
              <div key={op.id} className="flex items-center gap-3 bg-white px-4 py-3 rounded-lg border border-yellow-100">
                <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 font-semibold text-sm shrink-0">
                  {op.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{op.name}</p>
                  <p className="text-xs text-gray-400">Solicitado em {formatDate(op.createdAt)}</p>
                </div>
                <button
                  onClick={() => approveOperator(op.id)}
                  className="px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary-dark transition-colors"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => handleDelete(op.id, op.name)}
                  className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create operator manually */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Criar operador manualmente</h3>
        <p className="text-sm text-gray-500 mb-4">
          Crie as credenciais e repasse ao operador por WhatsApp ou email.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do operador"
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <input
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Senha"
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim() || !newPassword}
            className="px-4 py-2.5 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {creating ? 'Criando...' : 'Criar'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Active + inactive operators */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">
          Operadores ({active.length} ativos{inactive.length > 0 ? `, ${inactive.length} inativos` : ''})
        </h3>
        {[...active, ...inactive].length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Nenhum operador cadastrado ainda.</p>
        ) : (
          <div className="space-y-2">
            {[...active, ...inactive].map((op) => (
              <div key={op.id} className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {op.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{op.name}</p>
                    <p className="text-xs text-gray-400">Criado em {formatDate(op.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleActive(op.id, op.active)}
                    aria-label={op.active ? 'Desativar' : 'Ativar'}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                      op.active ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${op.active ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetId(resetId === op.id ? null : op.id)}
                    title="Redefinir senha"
                    className="p-1.5 text-gray-300 hover:text-primary transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(op.id, op.name)}
                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {resetId === op.id && (
                  <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex gap-2">
                    <input
                      type="text"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="Nova senha"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      onClick={() => handleResetPassword(op.id)}
                      disabled={resetting || !resetPassword}
                      className="px-3 py-2 bg-primary text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {resetting ? 'Salvando...' : 'Salvar'}
                    </button>
                    <button
                      onClick={() => { setResetId(null); setResetPassword('') }}
                      className="px-3 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
