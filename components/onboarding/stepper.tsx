import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

const STEPS = [
  { number: 1, label: 'Your business' },
  { number: 2, label: 'Getting paid' },
]

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Setup progress">
      {STEPS.map((step, index) => {
        const done = step.number < current
        const active = step.number === current

        return (
          <li key={step.number} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && 'border-primary text-primary',
                  !done && !active && 'border-border text-muted-foreground',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="size-3.5" /> : step.number}
              </span>
              <span
                className={cn(
                  'text-sm',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <span aria-hidden className={cn('h-px flex-1', done ? 'bg-primary' : 'bg-border')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
