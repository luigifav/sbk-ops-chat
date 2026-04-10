'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

interface LoginScreenProps {
  isAdmin?: boolean
}

function SbkLogoIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sbk-login-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#01B2AA" />
          <stop offset="100%" stopColor="#1F3A3A" />
        </linearGradient>
      </defs>
      <rect x="2" y="15" width="20" height="5" rx="1.5" fill="url(#sbk-login-g)" opacity="0.35" transform="rotate(-6 12 17.5)" />
      <rect x="2" y="10" width="20" height="5" rx="1.5" fill="url(#sbk-login-g)" opacity="0.6" transform="rotate(-6 12 12.5)" />
      <rect x="2" y="5" width="20" height="5" rx="1.5" fill="url(#sbk-login-g)" opacity="0.9" transform="rotate(-6 12 7.5)" />
    </svg>
  )
}

function DecorativeBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 600 900"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="deco-g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#01B2AA" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1F3A3A" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="deco-g2" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#01B2AA" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#2A7A6F" stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect x="-80" y="560" width="500" height="140" rx="16" fill="url(#deco-g1)" transform="rotate(-12 160 630)" />
      <rect x="100" y="420" width="460" height="130" rx="16" fill="url(#deco-g2)" transform="rotate(-12 330 485)" />
      <rect x="-20" y="280" width="480" height="120" rx="16" fill="url(#deco-g1)" transform="rotate(-12 220 340)" />
      <rect x="140" y="100" width="420" height="120" rx="16" fill="url(#deco-g2)" transform="rotate(-12 350 160)" />
    </svg>
  )
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

  const inputClass =
    'w-full pb-2.5 pt-1 border-0 border-b-2 border-brand-verde-escuro bg-transparent ' +
    'text-brand-verde-escuro text-sm focus:outline-none focus:border-brand-turquesa ' +
    'transition-colors duration-200 placeholder:text-brand-cinza-chumbo/50'

  const labelClass =
    'block text-[11px] font-semibold text-brand-verde-escuro mb-2 tracking-widest uppercase'

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* ── LEFT PANEL 55% ── */}
      <div className="md:w-[55%] bg-brand-verde-escuro flex flex-col justify-between p-10 md:p-16 relative overflow-hidden min-h-[220px] md:min-h-screen animate-slide-in-left">
        <DecorativeBg />

        {/* Logo */}
        <div className="relative flex items-center gap-3 z-10">
          <SbkLogoIcon size={28} />
          <span className="text-white font-semibold text-sm tracking-wide">SBK Operacional</span>
        </div>

        {/* Headline — desktop only */}
        <div className="relative z-10 hidden md:block">
          <h1
            className="text-[2.5rem] font-semibold text-white leading-tight mb-4 opacity-0 animate-fade-in-up anim-delay-200"
            style={{ animationFillMode: 'forwards' }}
          >
            Operações que<br />funcionam.
          </h1>
          <p
            className="text-brand-turquesa text-base opacity-0 animate-fade-in-up anim-delay-300"
            style={{ animationFillMode: 'forwards' }}
          >
            Assistente interno de Legal Operations.
          </p>
        </div>

        {/* Footer label */}
        <div className="relative z-10 hidden md:block">
          <p className="text-white/30 text-xs">
            {isAdmin ? 'Acesso restrito · Administradores' : 'Acesso restrito · Operadores SBK'}
          </p>
        </div>
      </div>

      {/* ── RIGHT PANEL 45% ── */}
      <div className="flex-1 md:w-[45%] bg-brand-gelo flex items-center justify-center p-8 md:p-16 animate-fade-in">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 md:hidden">
            <SbkLogoIcon size={20} />
            <span className="text-brand-verde-escuro font-semibold text-sm">SBK Operacional</span>
          </div>

          <h2 className="text-2xl font-semibold text-brand-verde-escuro mb-1.5">
            {isAdmin ? 'Acesso administrativo' : isRegister ? 'Solicitar acesso' : 'Entrar'}
          </h2>
          <p className="text-sm text-brand-cinza-chumbo mb-10">
            {isAdmin
              ? 'Painel de administração SBK'
              : isRegister
                ? 'Preencha os dados para solicitar acesso'
                : 'Bem-vindo de volta'}
          </p>

          {success && (
            <div className="mb-6 px-4 py-3 bg-brand-turquesa/10 border border-brand-turquesa/30 rounded-lg">
              <p className="text-sm text-brand-turquesa">{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            {!isAdmin && (
              <div>
                <label htmlFor="operatorName" className={labelClass}>Seu nome</label>
                <input
                  id="operatorName"
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="Como você se chama?"
                  className={inputClass}
                  autoFocus
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="password" className={labelClass}>
                {isAdmin ? 'Senha de acesso' : 'Senha'}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
                autoFocus={isAdmin}
                required
              />
            </div>

            {isRegister && (
              <div>
                <label htmlFor="inviteCode" className={labelClass}>Código de convite</label>
                <input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Código fornecido pelo admin"
                  className={inputClass}
                  required
                />
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/[0.08] border border-red-500/20 rounded-lg">
                <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full py-3 px-4 bg-brand-turquesa hover:bg-brand-verde-medio text-white font-semibold rounded-lg text-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Aguarde...' : isRegister ? 'Solicitar acesso' : 'Entrar'}
            </button>
          </form>

          {!isAdmin && (
            <p className="text-center text-xs text-brand-cinza-chumbo mt-8">
              {mode === 'login' ? (
                <>
                  Primeiro acesso?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(''); setSuccess('') }}
                    className="text-brand-turquesa hover:text-brand-verde-medio transition-colors font-semibold"
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
                    className="text-brand-turquesa hover:text-brand-verde-medio transition-colors font-semibold"
                  >
                    Fazer login
                  </button>
                </>
              )}
            </p>
          )}

          {!isAdmin && (
            <p className="text-center text-xs text-brand-cinza-chumbo/60 mt-4">
              Admin?{' '}
              <a href="/?admin=1" className="text-brand-cinza-chumbo hover:text-brand-verde-escuro transition-colors">
                Acessar painel
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
