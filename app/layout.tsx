import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { Toaster } from '@/components/ui/sonner'
import './globals.css'

// The CSS variable names must match what globals.css reads (--font-sans /
// --font-geist-mono); shadcn's theme block points at those, not at Geist's
// default variable names.
const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'Invoice-AI — GST invoices in a minute',
    template: '%s · Invoice-AI',
  },
  description:
    'Create a GST-compliant tax invoice, download the PDF, and send your client a link. No signup needed to start.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  )
}
