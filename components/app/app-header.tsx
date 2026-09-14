import Link from 'next/link'
import { FilePlus2, LayoutDashboard, LogOut, Settings, UserRound } from 'lucide-react'

import { signOutAction } from '@/lib/actions/auth'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AppHeader({ email, isGuest }: { email: string | null; isGuest: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-6">
          <Wordmark href={isGuest ? '/invoices/new' : '/dashboard'} />

          {!isGuest && (
            <nav className="hidden items-center gap-1 sm:flex">
              <NavLink href="/dashboard" icon={<LayoutDashboard className="size-4" />}>
                Invoices
              </NavLink>
              <NavLink href="/settings/business" icon={<Settings className="size-4" />}>
                Settings
              </NavLink>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link href="/invoices/new" />}>
            <FilePlus2 className="size-4" />
            New invoice
          </Button>

          {isGuest ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/claim" />}>
              Save my work
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Account menu" />}
              >
                <UserRound className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {email ?? 'Signed in'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/settings/business" />}>
                  <Settings className="size-4" />
                  Business settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* The menu item IS the submit button, wrapped in the form.
                    Rendering a <form> as the item and a button inside it would
                    put the click target one level below the focusable row, so
                    keyboard users could never trigger it. */}
                <form action={signOutAction}>
                  <DropdownMenuItem
                    variant="destructive"
                    render={<button type="submit" className="w-full" />}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
      {children}
    </Link>
  )
}
