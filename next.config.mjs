/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
// Content-Security-Policy notes:
//   - 'unsafe-inline' for script-src is required by Next.js App Router's
//     inline hydration scripts.  Once the project migrates to a nonce-based
//     CSP (Next.js 14 supports `nonce` via middleware), this can be tightened.
//   - 'unsafe-eval' is required by pdf.js (pdfjs-dist) which uses eval() in
//     its web worker.  Remove if pdf.js is replaced or bundled differently.
//   - worker-src includes blob: for the pdf.js worker created via Blob URL,
//     and https://unpkg.com as a fallback CDN source.
//   - Google Fonts: style-src includes fonts.googleapis.com; font-src includes
//     fonts.gstatic.com.
// ---------------------------------------------------------------------------
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob: https://unpkg.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]

const securityHeaders = [
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Control referrer information
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable unused browser features
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Content Security Policy
  { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
]

// HSTS — only inject in production so local dev still works over HTTP
if (process.env.NODE_ENV === 'production') {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    // 2-year max-age; includeSubDomains protects all sub-paths on Vercel.
    // Do NOT add `preload` unless the domain is submitted to the HSTS preload list.
    value: 'max-age=63072000; includeSubDomains',
  })
}

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
    serverActions: {
      // 25 MB body limit for document uploads.
      // SECURITY NOTE: This is intentionally large to support PDF/DOCX uploads.
      // The actual document text size is validated server-side in
      // app/api/admin/documents/route.ts (MAX_CONTENT_CHARS constant).
      bodySizeLimit: '25mb',
    },
  },

  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
