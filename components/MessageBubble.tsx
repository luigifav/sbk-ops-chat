'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export default function MessageBubble({
  role,
  content,
  isStreaming = false,
}: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in-up`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-turquesa flex items-center justify-center text-white text-[11px] font-semibold mr-2 mt-0.5">
          S
        </div>
      )}
      <div
        className={`max-w-[75%] px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand-verde-escuro text-white'
            : 'bg-white text-brand-verde-escuro border border-brand-turquesa/15 shadow-[0_2px_12px_rgba(31,58,58,0.06)]'
        }`}
        style={{
          borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
        }}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
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
                li: ({ children }) => (
                  <li className="text-sm leading-relaxed">{children}</li>
                ),
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
        {isStreaming && !isUser && (
          <span className="inline-flex gap-0.5 ml-1 align-middle mt-1">
            <span
              className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-1 h-1 rounded-full bg-brand-turquesa animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </span>
        )}
      </div>
    </div>
  )
}
