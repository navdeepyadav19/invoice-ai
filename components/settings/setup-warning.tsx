import { AlertTriangle } from 'lucide-react'

/**
 * Say it before they waste an afternoon.
 *
 * Without this, a misconfigured deployment looks identical to a wrong key: the
 * page creates a credential, shows it once, tells you to copy it — and every
 * request with it returns 401. The user has no way to tell which of those two
 * things went wrong, and the answer is in an env var they can't see.
 */
export function SetupWarning({ missing }: { missing: { name: string; why: string }[] }) {
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-medium">The API isn&rsquo;t configured on this deployment</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keys created here would be accepted by this page and then rejected by every request.
            Set these and redeploy:
          </p>

          <ul className="mt-3 space-y-2">
            {missing.map((item) => (
              <li key={item.name}>
                <code className="text-xs font-medium">{item.name}</code>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.why}</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted-foreground">
            See <code className="text-[11px]">.env.example</code> and{' '}
            <code className="text-[11px]">docs/platform/api-getting-started.md</code>.
          </p>
        </div>
      </div>
    </div>
  )
}
