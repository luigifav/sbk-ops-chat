'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

interface LoginScreenProps {
  isAdmin?: boolean
}

export default function LoginScreen({ isAdmin = false }: LoginScreenProps) {
  const [operatorName, setOperatorName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const endpoint = isAdmin ? '/api/admin/auth' : '/api/auth'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isAdmin
            ? { password }
            : { password, operatorName: operatorName.trim() }
        ),
      })

      const data = await res.json()

      if (res.ok) {
        router.push(isAdmin ? '/admin' : '/chat')
        router.refresh()
      } else {
        setError(data.error ?? 'Erro ao autenticar. Tente novamente.')
      }
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-white font-bold text-lg mb-4">
              SBK
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              {isAdmin ? 'Acesso Admin' : 'SBK Operacional'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {isAdmin
                ? 'Painel de administração'
                : 'Assistente de operações internas'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isAdmin && (
              <div>
                <label
                  htmlFor="operatorName"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Seu nome
                </label>
                <input
                  id="operatorName"
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="Como você se chama?"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  autoFocus
                  required
                />
              </div>
            )}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Senha de acesso
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite a senha"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                autoFocus={isAdmin}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password || (!isAdmin && !operatorName.trim())}
              className="w-full py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {!isAdmin && (
            <p className="text-center text-xs text-gray-400 mt-6">
              Acesso restrito a colaboradores SBK
            </p>
          )}
        </div>

        {!isAdmin && (
          <p className="text-center text-xs text-gray-400 mt-4">
            Admin?{' '}
            <a href="/?admin=1" className="text-primary hover:underline">
              Acessar painel
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
