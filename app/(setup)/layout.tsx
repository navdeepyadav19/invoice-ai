import { signOutAction } from '@/lib/actions/auth'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'

/**
 * Onboarding sits in its own route group rather than under (app) so the app
 * layout's "you must finish onboarding" redirect can be unconditional — a
 * wizard living inside the thing it gates would redirect to itself forever.
 */
export default function SetupLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
          <Wordmark />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-6 py-10 sm:py-14">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  )
}
