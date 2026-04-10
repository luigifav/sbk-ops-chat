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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold mr-2 mt-0.5">
          S
        </div>
      )}
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-white rounded-tr-sm'
            : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-tl-sm'
        }`}
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
                  <strong className="font-semibold text-gray-900">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic">{children}</em>
                ),
                h1: ({ children }) => (
                  <h1 className="text-base font-semibold text-gray-900 mt-3 mb-1 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-sm font-semibold text-gray-900 mt-3 mb-1 first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-medium text-gray-900 mt-2 mb-1 first:mt-0">{children}</h3>
                ),
                code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
                  inline ? (
                    <code className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">
                      {children}
                    </code>
                  ) : (
                    <code className="block bg-gray-100 text-gray-800 rounded p-2 text-xs font-mono overflow-x-auto whitespace-pre">
                      {children}
                    </code>
                  ),
                pre: ({ children }) => (
                  <pre className="bg-gray-100 rounded-lg p-3 text-xs font-mono overflow-x-auto mb-2 mt-1">
                    {children}
                  </pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-gray-300 pl-3 italic text-gray-600 mb-2">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary-dark"
                  >
                    {children}
                  </a>
                ),
                hr: () => <hr className="border-gray-200 my-2" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-2">
                    <table className="text-xs border-collapse w-full">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-gray-200 px-2 py-1">{children}</td>
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
              className="w-1 h-1 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1 h-1 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-1 h-1 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </span>
        )}
      </div>
    </div>
  )
}
