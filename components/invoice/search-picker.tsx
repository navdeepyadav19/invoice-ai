'use client'

import * as React from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Loader2, Search } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A server-backed typeahead built on Base UI's Combobox.
 *
 * It is a *picker*, not a value-holding select: choosing an item fires
 * `onPick` and the box resets, so the form fields it fills stay the single
 * source of truth. Base UI supplies the accessibility contract — role=combobox
 * on the input, role=listbox/option on the popup, arrow keys, Enter to pick,
 * Escape to close.
 *
 * Searches are debounced (200 ms) and stale responses are dropped, so a slow
 * reply to "ac" can never overwrite the results for "acme".
 *
 *   variant="inline"   the search input sits in the form (Bill to)
 *   variant="button"   a trigger button opens a popup with the input inside
 *                      (Add from catalog)
 */

const DEBOUNCE_MS = 200

export interface SearchPickerProps<T> {
  search: (query: string) => Promise<{ results: T[]; error?: string }>
  onPick: (item: T) => void
  getKey: (item: T) => string
  getLabel: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  isItemDisabled?: (item: T) => boolean
  placeholder: string
  /** Accessible name for the input and listbox. */
  label: string
  emptyText?: string
  variant?: 'inline' | 'button'
  /** The trigger's contents when variant="button". */
  trigger?: React.ReactNode
  disabled?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  className?: string
}

export function SearchPicker<T>({
  search,
  onPick,
  getKey,
  getLabel,
  renderItem,
  isItemDisabled,
  placeholder,
  label,
  emptyText = 'No matches.',
  variant = 'inline',
  trigger,
  disabled,
  inputRef,
  className,
}: SearchPickerProps<T>) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<T[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  const requestRef = React.useRef(0)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = React.useCallback(
    (value: string, delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const request = ++requestRef.current
      setLoading(true)

      timerRef.current = setTimeout(async () => {
        try {
          const result = await search(value)
          if (request !== requestRef.current) return
          setResults(result.results)
          setError(result.error ?? null)
        } catch {
          if (request !== requestRef.current) return
          setResults([])
          setError('Search failed. Try again.')
        } finally {
          if (request === requestRef.current) {
            setLoading(false)
            setLoaded(true)
          }
        }
      }, delay)
    },
    [search],
  )

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  function status(): React.ReactNode {
    if (loading && results.length === 0) {
      return (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Searching…
        </>
      )
    }
    if (error) return error
    if (loaded && results.length === 0) {
      return query.trim() ? `No matches for “${query.trim()}”.` : emptyText
    }
    return null
  }

  const statusContent = status()

  const input = (
    <Combobox.Input
      ref={inputRef}
      placeholder={placeholder}
      aria-label={label}
      onKeyDown={(event) => {
        // With the list closed, Enter would submit the surrounding invoice
        // form. Open, Base UI uses it to pick the highlighted option.
        if (event.key === 'Enter' && !open) event.preventDefault()
      }}
      className={cn(
        'h-8 w-full min-w-0 bg-transparent pr-2.5 pl-8 text-base outline-none placeholder:text-muted-foreground md:text-sm',
        variant === 'inline'
          ? 'rounded-lg border border-input transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30'
          : 'border-b border-border',
      )}
    />
  )

  const inputWithIcon = (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      {input}
      {loading && results.length > 0 && (
        <Loader2
          className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  )

  const list = (
    <>
      <Combobox.Status className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground empty:hidden">
        {statusContent}
      </Combobox.Status>
      <Combobox.List className="max-h-72 overflow-y-auto overscroll-contain p-1 empty:hidden">
        {(item: T) => (
          <Combobox.Item
            key={getKey(item)}
            value={item}
            disabled={isItemDisabled?.(item)}
            className="flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-60 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
          >
            {renderItem(item)}
          </Combobox.Item>
        )}
      </Combobox.List>
    </>
  )

  return (
    <Combobox.Root<T>
      items={results}
      filter={null}
      value={null}
      disabled={disabled}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Opening with nothing typed shows the most recent entries, so the
        // picker is useful before the user knows what to type.
        if (next && !loaded && !loading) runSearch(query, 0)
      }}
      inputValue={query}
      onInputValueChange={(next, details) => {
        // A pick would write the item's label into the box; the picker
        // resets instead (onValueChange), so ignore that echo.
        if (details.reason === 'item-press') return
        setQuery(next)
        runSearch(next, DEBOUNCE_MS)
      }}
      itemToStringLabel={getLabel}
      isItemEqualToValue={(a, b) => getKey(a) === getKey(b)}
      onValueChange={(item) => {
        if (!item) return
        onPick(item)
        setOpen(false)
        setQuery('')
        // The next open starts from the recent list again.
        setLoaded(false)
      }}
      autoHighlight
    >
      {variant === 'inline' ? (
        <div className={className}>{inputWithIcon}</div>
      ) : (
        <Combobox.Trigger
          className={cn(
            'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none select-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:size-4 [&_svg]:shrink-0',
            className,
          )}
        >
          {trigger}
        </Combobox.Trigger>
      )}

      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={4} align="start">
          <Combobox.Popup
            aria-label={label}
            aria-busy={loading || undefined}
            className={cn(
              'max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
              variant === 'inline' ? 'w-(--anchor-width)' : 'w-[min(26rem,var(--available-width))]',
            )}
          >
            {variant === 'button' && inputWithIcon}
            {list}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
