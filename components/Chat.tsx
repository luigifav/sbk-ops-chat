'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import MessageBubble from './MessageBubble'

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
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-xs font-bold">
            SBK
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">SBK Operacional</h1>
            <p className="text-xs text-gray-500">
              {operatorName ? `Olá, ${operatorName}` : 'Assistente de operações'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Limpar
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full pb-16">
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-primary font-bold text-sm">SBK</span>
              </div>
              <h2 className="text-base font-semibold text-gray-800 mb-1">
                Como posso ajudar?
              </h2>
              <p className="text-sm text-gray-500">
                Tire dúvidas sobre processos e operações da SBK.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {chips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(chip)}
                  className="px-3 py-2 text-sm border border-primary/30 text-primary rounded-full hover:bg-primary/5 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                isStreaming={msg.streaming}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Escreva sua dúvida..."
              rows={1}
              disabled={isStreaming}
              className="w-full resize-none px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 w-10 h-10 bg-primary hover:bg-primary-dark text-white rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
        <p className="text-xs text-gray-400 text-center mt-1.5">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  )
}
