'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import MessageBubble from './MessageBubble'
import SbkLogo from './SbkLogo'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface ChatProps {
  chips: string[]
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return randomId()
  const key = 'sbk_session_id'
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const newId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : randomId()
  sessionStorage.setItem(key, newId)
  return newId
}


export default function Chat({ chips }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setSessionId(getOrCreateSessionId())
    const match = document.cookie.match(/sbk_operator_name=([^;]+)/)
    if (match) setOperatorName(decodeURIComponent(match[1]))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      const userMsg: Message = { id: randomId(), role: 'user', content: text.trim() }
      const assistantMsg: Message = {
        id: randomId(),
        role: 'assistant',
        content: '',
        streaming: true,
      }

      const conversationHistory = messages.map(({ role, content }) => ({ role, content }))
      const nextHistory = [...conversationHistory, { role: userMsg.role, content: userMsg.content }]

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setInput('')
      setIsStreaming(true)

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: nextHistory, sessionId }),
        })

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + chunk,
              }
            }
            return updated
          })
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content:
                'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.',
              streaming: false,
            }
          }
          return updated
        })
      } finally {
        setIsStreaming(false)
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, streaming: false }
          }
          return updated
        })
      }
    },
    [messages, sessionId, isStreaming]
  )

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  function clearConversation() {
    setMessages([])
    setInput('')
  }

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' })
    window.location.href = '/'
  }

  return (
    <div className="flex flex-col h-screen bg-brand-gelo">
      {/* ── Header ── */}
      <header
        className="bg-brand-verde-escuro border-b-2 border-brand-turquesa px-4 flex items-center justify-between flex-shrink-0"
        style={{ height: '56px' }}
      >
        <div className="flex items-center gap-3">
          <SbkLogo color="#FFFFFF" width={88} height={30} />
          <div className="border-l border-white/20 pl-3">
            <p className="text-[11px] text-brand-turquesa leading-none">
              {operatorName ? `Olá, ${operatorName}` : 'Assistente de operações'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              Limpar
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-xs text-white/60 hover:text-white transition-colors"
          >
            Sair
          </button>
        </div>
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto py-6 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full pb-16 px-4">
            <div className="animate-fade-in-up">
              <SbkLogo color="#1F3A3A" width={160} height={54} />
            </div>
            <h2 className="text-xl font-semibold text-brand-verde-escuro mb-2 mt-5 animate-fade-in-up anim-delay-100">
              Como posso ajudar?
            </h2>
            <p className="text-sm text-brand-cinza-chumbo mb-7 animate-fade-in-up anim-delay-200">
              Tire dúvidas sobre processos e operações da SBK.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-md animate-fade-in-up anim-delay-300">
              {chips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(chip)}
                  className="px-4 py-2 text-sm border-[1.5px] border-brand-turquesa text-brand-verde-escuro rounded-full hover:bg-brand-turquesa hover:text-white hover:scale-[1.02] transition-all duration-[180ms]"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                isStreaming={msg.streaming}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div className="bg-white border-t border-brand-verde-escuro/[0.08] px-4 py-3 flex-shrink-0">
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Escreva sua dúvida..."
              rows={1}
              disabled={isStreaming}
              className="w-full resize-none px-3 py-2.5 border-[1.5px] border-brand-gelo bg-[#F8F9FB] rounded-xl text-sm text-brand-verde-escuro placeholder:text-brand-cinza-chumbo/60 focus:outline-none focus:border-brand-turquesa focus:shadow-[0_0_0_3px_rgba(1,178,170,0.12)] disabled:opacity-50 transition-all"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 w-10 h-10 bg-brand-turquesa hover:bg-brand-verde-medio hover:scale-[1.05] text-white rounded-[10px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
            title="Enviar (Enter)"
          >
            {isStreaming ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>
        <p className="text-[11px] text-brand-cinza-chumbo text-center mt-1.5">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  )
}
