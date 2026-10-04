import type { NextConfig } from 'next'

/**
 * Sent on every response. Deliberately no script-src CSP: Next's inline
 * bootstrap scripts would need a per-request nonce, which forces every page to
 * render dynamically. What is here is the part that costs nothing to get right:
 *
 *  - frame-ancestors / X-Frame-Options: nothing here is meant to be framed, and
 *    a framed "Authorize" (CLI login) or "Send" button is a clickjacking target.
 *  - Permissions-Policy: the microphone is used by voice-to-invoice on our own
 *    origin; nothing else is used at all.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Shared invoice links carry a bearer token in the URL. The page already
      // says noindex in its metadata; the PDF has no <head>, so both get the
      // header, and neither sends the token onward in a Referer.
      {
        source: '/i/:token*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/api/public/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },

  // react-pdf pulls in native-ish deps (fontkit, and its own font parsing) that
  // must not be bundled by the compiler — let Node require them at runtime.
  serverExternalPackages: ['@react-pdf/renderer'],

  // The PDF routes read .ttf files from disk. File tracing can't see a path
  // built at runtime with path.join, so the fonts are pulled in explicitly.
  // Without this the routes work locally and 500 on Vercel.
  outputFileTracingIncludes: {
    '/api/invoices/[id]/pdf': ['./assets/fonts/**'],
    '/api/public/[token]/pdf': ['./assets/fonts/**'],
  },
}

export default nextConfig
