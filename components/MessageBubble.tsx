'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import React from 'react'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  thinking?: boolean
  messageDbId?: string
  feedback?: 1 | -1 | null
  onFeedback?: (id: string, value: 1 | -1 | null) => void
  isError?: boolean
  onRetry?: () => void
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}

function CopyableListItem({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = extractText(children)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <li className="text-sm leading-relaxed group/item flex items-start gap-1.5">
      <span className="flex-1">{children}</span>
      <button
        onClick={handleCopy}
        className="flex-shrink-0 mt-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity text-brand-cinza-chumbo hover:text-brand-turquesa"
        title="Copiar item"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5 text-brand-turquesa" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </li>
  )
}

export default function MessageBubble({
  role,
  content,
  isStreaming = false,
  thinking = false,
  messageDbId,
  feedback,
  onFeedback,
  isError = false,
  onRetry,
}: MessageBubbleProps) {
  const isUser = role === 'user'
  const [copiedAll, setCopiedAll] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  function handleCopyAll() {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    })
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in-up`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-turquesa flex items-center justify-center text-white text-[11px] font-semibold mr-2 mt-0.5">
          S
        </div>
      )}
      <div className={`max-w-[75%] ${!isUser ? 'flex flex-col gap-1' : ''}`}>
        <div
          className={`relative px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-brand-verde-escuro text-white'
              : 'bg-white text-brand-verde-escuro border border-brand-turquesa/15 shadow-[0_2px_12px_rgba(31,58,58,0.06)]'
          }`}
          style={{
            borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Copy all button (assistant only, hover) */}
          {!isUser && !isStreaming && !thinking && content && (
            <button
              onClick={handleCopyAll}
              className={`absolute top-2 right-2 transition-opacity text-brand-cinza-chumbo hover:text-brand-turquesa ${
                isHovered ? 'opacity-100' : 'opacity-0'
              }`}
              title="Copiar resposta completa"
            >
              {copiedAll ? (
                <svg className="w-3.5 h-3.5 text-brand-turquesa" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}

          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : thinking ? (
            <span className="inline-flex items-center gap-1.5 text-brand-cinza-chumbo text-xs">
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              Pensando...
            </span>
          ) : (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => (
                    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
                  ),
                  li: ({ children }) => <CopyableListItem>{children}</CopyableListItem>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-brand-verde-escuro">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic">{children}</em>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-base font-semibold text-brand-verde-escuro mt-3 mb-1 first:mt-0">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-sm font-semibold text-brand-verde-escuro mt-3 mb-1 first:mt-0">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-medium text-brand-verde-escuro mt-2 mb-1 first:mt-0">{children}</h3>
                  ),
                  code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
                    inline ? (
                      <code className="bg-brand-gelo text-brand-verde-escuro px-1 py-0.5 rounded text-xs font-mono">
                        {children}
                      </code>
                    ) : (
                      <code className="block bg-brand-gelo text-brand-verde-escuro rounded p-2 text-xs font-mono overflow-x-auto whitespace-pre">
                        {children}
                      </code>
                    ),
                  pre: ({ children }) => (
                    <pre className="bg-brand-gelo rounded-lg p-3 text-xs font-mono overflow-x-auto mb-2 mt-1">
                      {children}
                    </pre>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-brand-turquesa/40 pl-3 italic text-brand-cinza-chumbo mb-2">
                      {children}
                    </blockquote>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-turquesa underline hover:text-brand-verde-medio"
                    >
                      {children}
                    </a>
                  ),
                  hr: () => <hr className="border-brand-turquesa/20 my-2" />,
                  table: ({ children }) => (
                    <div className="overflow-x-auto mb-2">
                      <table className="text-xs border-collapse w-full">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-brand-turquesa/20 bg-brand-gelo px-2 py-1 text-left font-semibold text-brand-verde-escuro">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-brand-turquesa/15 px-2 py-1">{children}</td>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          )}

          {isStreaming && !isUser && !thinking && (
            <span className="inline-flex gap-0.5 ml-1 align-middle mt-1">
              <span className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </div>

        {/* Feedback + retry row (assistant only, after streaming) */}
        {!isUser && !isStreaming && !thinking && (
          <div className="flex items-center gap-2 pl-1">
            {isError && onRetry && (
              <button
                onClick={onRetry}
                className="text-xs text-brand-cinza-chumbo hover:text-brand-turquesa transition-colors flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Tentar novamente
              </button>
            )}
            {messageDbId && onFeedback && (
              <>
                <button
                  onClick={() => onFeedback(messageDbId, feedback === 1 ? null : 1)}
                  className={`text-xs transition-colors ${
                    feedback === 1
                      ? 'text-brand-turquesa'
                      : 'text-brand-cinza-chumbo/50 hover:text-brand-turquesa'
                  }`}
                  title="Resposta útil"
                >
                  <svg className="w-3.5 h-3.5" fill={feedback === 1 ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                  </svg>
                </button>
                <button
                  onClick={() => onFeedback(messageDbId, feedback === -1 ? null : -1)}
                  className={`text-xs transition-colors ${
                    feedback === -1
                      ? 'text-red-400'
                      : 'text-brand-cinza-chumbo/50 hover:text-red-400'
                  }`}
                  title="Resposta não útil"
                >
                  <svg className="w-3.5 h-3.5" fill={feedback === -1 ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
