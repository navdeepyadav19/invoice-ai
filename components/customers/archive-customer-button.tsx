'use client'

import { useState, useTransition } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { archiveCustomerAction, unarchiveCustomerAction } from '@/lib/actions/customers'

/**
 * Archive / restore behind a confirmation. Archiving hides the customer from
 * lists and pickers; invoices already issued to them keep their link.
 */
export function ArchiveCustomerButton({
  id,
  name,
  archived,
}: {
  id: string
  name: string
  archived: boolean
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = archived ? await unarchiveCustomerAction(id) : await archiveCustomerAction(id)
      if (result.error) setError(result.error)
      else setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        {archived ? 'Restore' : 'Archive'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {archived ? 'Restore' : 'Archive'} &ldquo;{name}&rdquo;?
          </DialogTitle>
          <DialogDescription>
            {archived
              ? 'They will show up in your customer list and the invoice builder again.'
              : 'They will be hidden from your customer list and the invoice builder. Invoices already raised for them are not affected, and you can restore them any time.'}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant={archived ? 'default' : 'destructive'} disabled={isPending} onClick={confirm}>
            {isPending
              ? archived
                ? 'Restoring…'
                : 'Archiving…'
              : archived
                ? 'Restore customer'
                : 'Archive customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
