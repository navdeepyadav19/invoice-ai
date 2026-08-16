import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
