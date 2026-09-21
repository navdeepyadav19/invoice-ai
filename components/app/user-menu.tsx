'use client'

import Link from 'next/link'
import { ChevronsUpDown, LogOut, Settings, UserRound } from 'lucide-react'

import { signOutAction } from '@/lib/actions/auth'
import { initialsFromEmail } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Bottom-of-sidebar account block. Guests have no account to manage, so they
 * get the "Save my work" claim CTA instead of a menu (same as the old header).
 */
export function UserMenu({
  email,
  isGuest,
  emailUnverified,
  collapsed,
}: {
  email: string | null
  isGuest: boolean
  emailUnverified: boolean
  collapsed: boolean
}) {
  if (isGuest) {
    return collapsed ? (
      <Button
        variant="outline"
        size="icon"
        className="mx-auto flex"
        nativeButton={false}
        render={<Link href="/claim" />}
        title="Save my work"
      >
        <UserRound aria-hidden="true" />
        <span className="sr-only">Save my work</span>
      </Button>
    ) : (
      <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/claim" />}>
        <UserRound aria-hidden="true" />
        Save my work
      </Button>
    )
  }

  const unverifiedBadge = (
    <Badge
      variant="outline"
      className="border-warning/40 text-warning"
      title="Check your inbox for the verification link"
    >
      Unverified
    </Badge>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md p-1.5 text-left text-sm transition-colors outline-none hover:bg-sidebar-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-sidebar-accent/60',
              collapsed && 'justify-center',
            )}
          />
        }
        aria-label={`Account menu${email ? ` for ${email}` : ''}${emailUnverified ? ' (email unverified)' : ''}`}
      >
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {initialsFromEmail(email)}
          {collapsed && emailUnverified && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning ring-2 ring-sidebar"
              aria-hidden="true"
            />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-foreground">{email ?? 'Signed in'}</span>
              {emailUnverified && <span className="mt-0.5">{unverifiedBadge}</span>}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
          <span className="truncate">{email ?? 'Signed in'}</span>
          {emailUnverified && unverifiedBadge}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings/business" />}>
          <Settings className="size-4" />
          Business settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* The menu item IS the submit button, wrapped in the form.
            Rendering a <form> as the item and a button inside it would put the
            click target one level below the focusable row, so keyboard users
            could never trigger it. */}
        <form action={signOutAction}>
          <DropdownMenuItem variant="destructive" render={<button type="submit" className="w-full" />}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
