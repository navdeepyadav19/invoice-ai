import { AlertCircle, CheckCircle2 } from 'lucide-react'

export function FormError({ message }: { message?: string }) {
  if (!message) return null

  return (
    <p
      // role="alert" so a screen reader announces the failure instead of the
      // user re-submitting a form that silently rejected them.
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  )
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-success"
    >
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  )
}
