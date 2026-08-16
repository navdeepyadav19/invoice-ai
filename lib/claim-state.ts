export interface ClaimState {
  error?: string
  message?: string
  /** Set when the chosen address already belongs to a permanent account. */
  conflictEmail?: string
}
