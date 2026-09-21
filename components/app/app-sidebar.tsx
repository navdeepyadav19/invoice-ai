'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Building2,
  FilePlus2,
  FileText,
  KeyRound,
  LayoutDashboard,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

import { Mark, Wordmark } from '@/components/brand'
import { UserMenu } from '@/components/app/user-menu'
import { Button } from '@/components/ui/button'
import { isNavItemActive, type NavMatchable } from '@/lib/nav'
import { cn } from '@/lib/utils'

type NavItem = NavMatchable & { label: string; icon: LucideIcon }

/*
 * There is no /invoices list route: the invoice list lives on /dashboard.
 * Invoices therefore links there, but owns /invoices/* (new, edit) for its
 * active state so Dashboard and Invoices never light up together.
 */
const PRIMARY_NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard', match: ['/invoices'], label: 'Invoices', icon: FileText },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/products', label: 'Products', icon: Package },
]

const SETTINGS_NAV: readonly NavItem[] = [
  { href: '/settings/business', label: 'Business', icon: Building2 },
  { href: '/settings/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/settings/webhooks', label: 'Webhooks', icon: Webhook },
  { href: '/settings/activity', label: 'Activity', icon: Activity },
]

export type SidebarUser = {
  email: string | null
  isGuest: boolean
  emailUnverified: boolean
}

/**
 * The sidebar's contents. Rendered twice by AppShell: once in the desktop
 * <aside> (which can be collapsed to icons) and once inside the mobile drawer
 * (always expanded).
 */
export function SidebarContents({
  user,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  user: SidebarUser
  collapsed?: boolean
  /** Present only on desktop, where the rail can collapse. */
  onToggleCollapsed?: () => void
  /** Called after any in-sidebar navigation; the drawer uses it to close. */
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const homeHref = user.isGuest ? '/invoices/new' : '/dashboard'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand + collapse toggle */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center gap-2 px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        {collapsed ? (
          <Link
            href={homeHref}
            onClick={onNavigate}
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Mark className="size-7" />
            <span className="sr-only">Invoice AI home</span>
          </Link>
        ) : (
          <Wordmark href={homeHref} className="min-w-0 flex-1" />
        )}
        {onToggleCollapsed && !collapsed && (
          <CollapseButton collapsed={false} onClick={onToggleCollapsed} />
        )}
      </div>

      <div className={cn('shrink-0 px-3 pb-2', collapsed && 'flex flex-col items-center gap-2 px-0')}>
        {onToggleCollapsed && collapsed && (
          <CollapseButton collapsed onClick={onToggleCollapsed} />
        )}
        {collapsed ? (
          <Button
            size="icon"
            nativeButton={false}
            render={<Link href="/invoices/new" onClick={onNavigate} />}
            title="New invoice"
          >
            <FilePlus2 aria-hidden="true" />
            <span className="sr-only">New invoice</span>
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full"
            nativeButton={false}
            render={<Link href="/invoices/new" onClick={onNavigate} />}
          >
            <FilePlus2 aria-hidden="true" />
            New invoice
          </Button>
        )}
      </div>

      <nav
        aria-label="Main"
        className={cn('min-h-0 flex-1 overflow-y-auto px-3 py-2', collapsed && 'px-2')}
      >
        {user.isGuest ? (
          <GuestNote collapsed={collapsed} onNavigate={onNavigate} />
        ) : (
          <>
            <NavList
              items={PRIMARY_NAV}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
            <div className="mt-6">
              {collapsed ? (
                <div className="mx-2 mb-2 border-t border-sidebar-border" aria-hidden="true" />
              ) : (
                <p
                  aria-hidden="true"
                  className="mb-1 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Settings
                </p>
              )}
              <NavList
                items={SETTINGS_NAV}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
                label="Settings"
              />
            </div>
          </>
        )}
      </nav>

      <div className={cn('shrink-0 border-t border-sidebar-border p-3', collapsed && 'px-2')}>
        <UserMenu
          email={user.email}
          isGuest={user.isGuest}
          emailUnverified={user.emailUnverified}
          collapsed={collapsed}
        />
      </div>
    </div>
  )
}

function NavList({
  items,
  pathname,
  collapsed,
  onNavigate,
  label,
}: {
  items: readonly NavItem[]
  pathname: string | null
  collapsed: boolean
  onNavigate?: () => void
  label?: string
}) {
  return (
    <ul className="flex flex-col gap-0.5" aria-label={label}>
      {items.map((item) => {
        const active = isNavItemActive(pathname, item)
        const Icon = item.icon
        return (
          <li key={item.label}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Guests get no navigation — they only have the builder — just the nudge to keep their work. */
function GuestNote({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  if (collapsed) return null
  return (
    <div className="rounded-lg border border-primary/15 bg-primary/[0.06] p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        Guest mode
      </p>
      <p className="mt-1 text-muted-foreground">
        Add an email to keep your invoices and unlock customers, products and settings.
      </p>
      <Link
        href="/claim"
        onClick={onNavigate}
        className="mt-2 inline-block font-medium text-primary underline underline-offset-4 hover:opacity-80"
      >
        Save my work
      </Link>
    </div>
  )
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className="text-muted-foreground"
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}
