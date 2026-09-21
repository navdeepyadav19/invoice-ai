import type { ZodError } from 'zod'

/**
 * Shared form plumbing.
 *
 * This deliberately lives OUTSIDE any 'use server' module: those may only export
 * async functions, so a single exported constant or sync helper makes Next treat
 * the whole file as having no exports — and the error surfaces at the import
 * site, not at the offending line.
 */

/**
 * What a failed submission sends back so the form can put it back on screen.
 *
 * Single-valued fields are a string; a name submitted more than once (a group
 * of checkboxes sharing `name="scopes"`) is a string[]. Read it with
 * `keptValues()` rather than indexing it directly.
 */
export type FormValues = Record<string, string | string[]>

export interface StepState {
  error?: string
  fieldErrors?: Record<string, string>
  /**
   * The values that were submitted, echoed back so the form can restore them.
   *
   * React resets a form after its action runs, including on a failed
   * validation — uncontrolled inputs snap back to their `defaultValue` and the
   * user loses everything they typed. Feeding these values in as the
   * `defaultValue` (and remounting the form with `useSubmissionKey`) means the
   * reset restores their work instead of erasing it.
   */
  values?: FormValues
  saved?: boolean
}

export interface AuthFormState {
  error?: string
  message?: string
  /** See StepState.values. Never contains passwords — echoValues drops them. */
  values?: FormValues
}

/** Carries a guest's single-use merge token across a sign-in. */
export const PENDING_MERGE_COOKIE = 'pending_merge_uid'

/**
 * Field names never echoed back into the DOM, however the form failed.
 * `gst_data` isn't secret, just a large JSON blob the form re-derives itself.
 */
const NEVER_ECHO = new Set(['password', 'confirm_password', 'gst_data'])

/**
 * Anything that smells like a credential is dropped too, so a new form can't
 * leak one by forgetting to list it. Clearing these on failure is deliberate.
 */
const SENSITIVE = /pass(word|code|phrase)|secret|token|api_?key|plaintext|otp|cvv|cvc|card_number/i

/** True for a field whose value must never be sent back to the browser. */
export function isSensitiveField(name: string): boolean {
  return NEVER_ECHO.has(name) || SENSITIVE.test(name) || name.startsWith('$ACTION')
}

export interface EchoOptions {
  /** Extra field names to leave out, on top of the built-in sensitive list. */
  omit?: readonly string[]
}

/**
 * Collects the submitted text values so a failed form can be repopulated.
 *
 * Files and sensitive fields are skipped. A name that appears more than once
 * becomes an array, in submission order.
 */
export function echoValues(formData: FormData, options: EchoOptions = {}): FormValues {
  const omit = new Set(options.omit ?? [])
  const values: FormValues = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue
    if (omit.has(key) || isSensitiveField(key)) continue

    const existing = values[key]
    if (existing === undefined) values[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else values[key] = [existing, value]
  }

  return values
}

/**
 * Attach the echoed submission to any failure state:
 *
 *   if (error) return withValues({ error: 'Could not save.' }, formData)
 */
export function withValues<T extends object>(
  state: T,
  formData: FormData,
  options?: EchoOptions,
): T & { values: FormValues } {
  return { ...state, values: echoValues(formData, options) }
}

/**
 * Read echoed values back in a component.
 *
 *   const kept = keptValues(state.values)
 *   <Input name="legal_name" defaultValue={kept.text('legal_name', business?.legal_name)} />
 *   <Checkbox name="events" value={e} defaultChecked={kept.checked('events', e)} />
 *
 * Before any failed submission (`values` undefined) every reader returns its
 * fallback — usually the saved record. After one, the submission wins, and an
 * unticked checkbox group reads as empty rather than falling back.
 */
export interface KeptValues {
  /** True when there is a failed submission to restore. */
  readonly submitted: boolean
  text(name: string, fallback?: string | number | null): string
  list(name: string, fallback?: readonly string[]): string[]
  checked(name: string, value?: string, fallback?: boolean): boolean
}

export function keptValues(values: FormValues | undefined): KeptValues {
  const all = (name: string): string[] | undefined => {
    const raw = values?.[name]
    if (raw === undefined) return undefined
    return Array.isArray(raw) ? raw : [raw]
  }

  return {
    submitted: values !== undefined,
    text(name, fallback) {
      const raw = all(name)
      if (raw?.length) return raw[0]
      return fallback === null || fallback === undefined ? '' : String(fallback)
    },
    list(name, fallback = []) {
      if (values === undefined) return [...fallback]
      return all(name) ?? []
    },
    checked(name, value = 'on', fallback = false) {
      if (values === undefined) return fallback
      return all(name)?.includes(value) ?? false
    },
  }
}

/**
 * Flattens a Zod error into one message per field, keeping the first per path,
 * and echoes the submission back so nothing typed is lost.
 */
export function toFieldErrors(error: ZodError, formData?: FormData): StepState {
  const fieldErrors: Record<string, string> = {}

  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }

  return {
    fieldErrors,
    error: 'Fix the highlighted fields and try again.',
    values: formData ? echoValues(formData) : undefined,
  }
}
