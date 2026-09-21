'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

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
import type { CatalogActionResult } from '@/lib/actions/products'

/**
 * A button that asks before running a one-shot server action (archive /
 * restore). The dialog stays open with the error if the action fails.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  successMessage,
  destructive = false,
  run,
  children,
}: {
  /** The trigger element (e.g. a Button); `children` are its contents. */
  trigger: React.ReactElement
  children: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel: string
  successMessage: string
  destructive?: boolean
  run: () => Promise<CatalogActionResult>
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function confirm() {
    setError(undefined)
    startTransition(async () => {
      const result = await run()
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      toast.success(successMessage)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(undefined)
      }}
    >
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
