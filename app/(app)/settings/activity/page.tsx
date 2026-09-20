import type { Metadata } from 'next'
import { Activity } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { contextFromSession } from '@/lib/auth/context'
import { getCurrentUser } from '@/lib/queries'
import type { ApiKeyRow, ApiRequestRow } from '@/lib/database.types'

export const metadata: Metadata = { title: 'API activity' }

/**
 * "Which app issued this invoice?" needs an answer.
 *
 * invoice_events records state changes, but not reads and not the credential
 * behind them. api_requests does, and without a screen for it the table is
 * write-only — which makes it useless for the two questions people actually
 * ask: "is my integration working?" and "what did that key do?".
 *
 * Append-only by RLS policy: readable by its owner, never updatable or
 * deletable. An audit log a caller can edit is not an audit log.
 */
export default async function ActivityPage() {
  const user = await getCurrentUser()

  if (user?.is_anonymous) {
    return (
      <div className="space-y-8">
        <Header />
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          Guest accounts can&rsquo;t use the API, so there&rsquo;s nothing to show here.
        </p>
      </div>
    )
  }

  const ctx = await contextFromSession()

  const [{ data: requests }, { data: keys }] = await Promise.all([
    ctx.supabase
      .from('api_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    ctx.supabase.from('api_keys').select('*'),
  ])

  const rows = (requests ?? []) as ApiRequestRow[]
  const keyNames = new Map(((keys ?? []) as ApiKeyRow[]).map((key) => [key.id, key.name]))

  return (
    <div className="space-y-8">
      <Header />

      {rows.length === 0 ? (
        <section className="rounded-lg border border-dashed p-8 text-center">
          <Activity className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No API requests yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Once something calls the API with one of your keys, every request shows up here — including
            the ones that failed, which is usually what you want to see.
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Request</th>
                <th className="px-4 py-2 text-left font-medium">Result</th>
                <th className="px-4 py-2 text-left font-medium">Key</th>
                <th className="px-4 py-2 text-left font-medium">Took</th>
                <th className="px-4 py-2 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <code className="text-xs">
                      {row.method} {row.route}
                    </code>
                    {row.idempotency_key ? (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Idempotency-Key set
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.api_key_id
                      ? (keyNames.get(row.api_key_id) ?? 'Deleted key')
                      : row.via === 'session'
                        ? 'This browser'
                        : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{row.duration_ms}ms</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Kept for 30 days. IP addresses are stored hashed, never in full.
      </p>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h2 className="text-lg font-medium">API activity</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every request made with one of your API keys, newest first.
      </p>
    </div>
  )
}

/**
 * Grouped by what the caller should do about it, not by exact code. A 401 and a
 * 403 are both "fix your credential"; a 500 is "not your fault".
 */
function StatusBadge({ status }: { status: number }) {
  if (status < 300) return <Badge>{status} OK</Badge>

  const hint =
    status === 401
      ? 'Bad or missing key'
      : status === 403
        ? 'Key lacks the scope'
        : status === 404
          ? 'Not found'
          : status === 409
            ? 'Wrong state'
            : status === 422
              ? 'Invalid request'
              : status === 428
                ? 'Needs Idempotency-Key'
                : status === 429
                  ? 'Rate limited'
                  : status >= 500
                    ? 'Our side'
                    : 'Failed'

  return (
    <div className="min-w-0">
      <Badge variant="outline">{status}</Badge>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
    </div>
  )
}
