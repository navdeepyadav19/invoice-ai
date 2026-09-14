'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Download, Loader2, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'

import { sendInvoiceAction } from '@/lib/actions/send'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { InvoiceStatus } from '@/lib/database.types'

export function SendControls({
  invoiceId,
  status,
  clientEmail,
  disabled,
}: {
  invoiceId?: string
  status: InvoiceStatus
  clientEmail: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [sentUrl, setSentUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Nothing to send or download until the draft has been persisted once.
  if (!invoiceId) return null

  const isDraft = status === 'draft'
  const canEmail = clientEmail.trim().length > 0

  function issue(withEmail: boolean) {
    startTransition(async () => {
      const result = await sendInvoiceAction(invoiceId!, { email: withEmail })

      // The invoice can be issued AND the email fail, so a message and a URL can
      // arrive together — show both rather than treating this as pass/fail.
      if (result.error) toast.error(result.error)
      else if (result.emailed) toast.success(`Sent to ${clientEmail}`)
      else if (result.invoiceNumber) toast.success(`Issued as ${result.invoiceNumber}`)

      if (result.publicUrl) setSentUrl(result.publicUrl)
      router.refresh()
    })
  }

  async function copy() {
    if (!sentUrl) return
    await navigator.clipboard.writeText(sentUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<a href={`/api/invoices/${invoiceId}/pdf`} target="_blank" rel="noreferrer" />}
      >
        <Download className="size-4" />
        PDF
      </Button>

      {canEmail && (
        <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => issue(true)}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Email it
        </Button>
      )}

      <Button size="sm" disabled={disabled || pending} onClick={() => issue(false)}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {isDraft ? 'Issue invoice' : 'Get link'}
      </Button>

      <Dialog open={Boolean(sentUrl)} onOpenChange={(open) => !open && setSentUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your invoice is ready to share</DialogTitle>
            <DialogDescription>
              Anyone with this link can view and download the invoice. It doesn&rsquo;t require an
              account.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input readOnly value={sentUrl ?? ''} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
