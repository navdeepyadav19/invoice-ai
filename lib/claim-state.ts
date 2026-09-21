import type { FormValues } from '@/lib/form-state'

export interface ClaimState {
  error?: string
  /** The submitted email, echoed back on failure. The password never is. */
  values?: FormValues
  message?: string
  /** Set when the chosen address already belongs to a permanent account. */
  conflictEmail?: string
}
