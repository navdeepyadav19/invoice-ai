'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, Building2, KeyRound, Webhook } from 'lucide-react'

import { cn } from '@/lib/utils'

const SECTIONS = [
  {
    href: '/settings/business',
    label: 'Business',
    icon: Building2,
    description: 'Name, GSTIN, bank details, numbering',
  },
  {
    href: '/settings/api-keys',
    label: 'API keys',
    icon: KeyRound,
    description: 'Let other systems raise invoices',
  },
  {
    href: '/settings/webhooks',
    label: 'Webhooks',
    icon: Webhook,
    description: 'Get told when an invoice is paid',
  },
  {
    href: '/settings/activity',
    label: 'Activity',
    icon: Activity,
    description: 'What called the API, and what happened',
  },
] as const

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings sections" className="lg:w-56 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {SECTIONS.map((section) => {
          const active = pathname === section.href
          const Icon = section.icon

          return (
            <li key={section.href} className="shrink-0 lg:shrink">
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{section.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
