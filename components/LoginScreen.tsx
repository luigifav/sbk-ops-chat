'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

interface LoginScreenProps {
  isAdmin?: boolean
}

export default function LoginScreen({ isAdmin = false }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [operatorName, setOperatorName] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (isAdmin) {
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const data = await res.json()
        if (res.ok) {
          router.push('/admin')
          router.refresh()
        } else {
          setError(data.error ?? 'Erro ao autenticar.')
        }
        return
      }

      if (mode === 'register') {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operatorName: operatorName.trim(),
            password,
            isNewAccount: true,
            inviteCode,
          }),
        })
        const data = await res.json()
        if (res.ok && data.pending) {
          setSuccess(data.message)
          setMode('login')
          setPassword('')
          setInviteCode('')
        } else {
          setError(data.error ?? 'Erro ao criar conta.')
        }
        return
      }

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorName: operatorName.trim(),
          password,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        router.push('/chat')
        router.refresh()
      } else {
        setError(data.error ?? 'Erro ao autenticar.')
      }
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const isRegister = !isAdmin && mode === 'register'
  const canSubmit = isAdmin
    ? !!password
    : isRegister
      ? !!operatorName.trim() && !!password && !!inviteCode
      : !!operatorName.trim() && !!password

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-white font-bold text-lg mb-4">
              SBK
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              {isAdmin ? 'Acesso Admin' : isRegister ? 'Criar conta' : 'SBK Operacional'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {isAdmin
                ? 'Painel de administração'
                : isRegister
                  ? 'Preencha os dados para solicitar acesso'
                  : 'Assistente de operações internas'}
            </p>
          </div>

          {success && (
            <div className="mb-4 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700">{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isAdmin && (
              <div>
                <label htmlFor="operatorName" className="block text-sm font-medium text-gray-700 mb-1.5">
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
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                autoFocus={isAdmin}
                required
              />
            </div>

            {isRegister && (
              <div>
                <label htmlFor="inviteCode" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Código de convite
                </label>
                <input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Código fornecido pelo admin"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  required
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Aguarde...' : isRegister ? 'Solicitar acesso' : 'Entrar'}
            </button>
          </form>

          {!isAdmin && (
            <p className="text-center text-xs text-gray-400 mt-6">
              {mode === 'login' ? (
                <>
                  Primeiro acesso?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(''); setSuccess('') }}
                    className="text-primary hover:underline"
                  >
                    Criar conta
                  </button>
                </>
              ) : (
                <>
                  Já tem conta?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(''); setSuccess('') }}
                    className="text-primary hover:underline"
                  >
                    Fazer login
                  </button>
                </>
              )}
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
