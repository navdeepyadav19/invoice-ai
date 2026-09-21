'use client'

import Link from 'next/link'
import { FilePlus2, Menu } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { SidebarContents, type SidebarUser } from '@/components/app/app-sidebar'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/nav'
import { cn } from '@/lib/utils'

const ONE_YEAR = 60 * 60 * 24 * 365

/**
 * The signed-in app chrome: a left sidebar on md+ (collapsible to an icon
 * rail), a top bar + off-canvas drawer below md, and a main column that scrolls
 * on its own so the sidebar never moves.
 *
 * The collapsed preference lives in a cookie rather than localStorage so the
 * server layout can read it and render the right width on first paint — no
 * flash of a wide sidebar snapping shut after hydration.
 */
export function AppShell({
  user,
  defaultCollapsed,
  banners,
  children,
}: {
  user: SidebarUser
  defaultCollapsed: boolean
  /** Rendered at the top of the main column, above the page. */
  banners?: React.ReactNode
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? '1' : '0'}; path=/; max-age=${ONE_YEAR}; samesite=lax`
      } catch {
        // Cookies blocked: the toggle still works for this session.
      }
      return next
    })
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // The drawer only exists below md. If the viewport grows past it while open,
  // close it so the modal (and its scroll lock) doesn't linger invisibly.
  useEffect(() => {
    if (!drawerOpen) return
    const mq = window.matchMedia('(min-width: 48rem)')
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [drawerOpen])

  return (
    <div className="flex h-svh w-full overflow-hidden">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        aria-label="Sidebar"
        data-collapsed={collapsed || undefined}
        className={cn(
          'hidden shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarContents user={user} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background px-4 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <Wordmark href={user.isGuest ? '/invoices/new' : '/dashboard'} className="min-w-0 flex-1" />
          <Button
            size="icon"
            nativeButton={false}
            render={<Link href="/invoices/new" />}
            title="New invoice"
          >
            <FilePlus2 aria-hidden="true" />
            <span className="sr-only">New invoice</span>
          </Button>
        </header>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent id="mobile-nav" side="left" className="md:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContents user={user} onNavigate={closeDrawer} />
          </SheetContent>
        </Sheet>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
          {banners}
          {children}
        </main>
      </div>
    </div>
  )
}
