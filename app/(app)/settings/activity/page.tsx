import type { Metadata } from 'next'
import { Activity } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { contextFromSession } from '@/lib/auth/context'
import { requestCaller, requestLabel } from '@/lib/connected-apps'
import type { ApiKeyRow, ApiRequestRow } from '@/lib/database.types'
import { oauthListGrants } from '@/lib/db/rpc'

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
  const ctx = await contextFromSession()

  const [requests, keys, grants] = await Promise.all([
    ctx.db.selectFrom('api_requests').selectAll().orderBy('created_at', 'desc').limit(100).execute(),
    ctx.db.selectFrom('api_keys').select(['id', 'name']).execute(),
    // Revoked grants too: a request made last week by an app disconnected
    // yesterday should still say which app it was.
    oauthListGrants(ctx.db, true),
  ])

  const rows = requests as ApiRequestRow[]
  const keyNames = new Map((keys as Pick<ApiKeyRow, 'id' | 'name'>[]).map((key) => [key.id, key.name]))
  // api_requests.client_id is the oauth_clients uuid, which is client_uuid here.
  const appNames = new Map(grants.map((grant) => [grant.client_uuid, grant.client_name]))

  return (
    <div className="space-y-8">
      <Header />

      {rows.length === 0 ? (
        <section className="rounded-lg border border-dashed p-8 text-center">
          <Activity className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No API requests yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Once something calls the API with one of your keys, or a connected assistant uses a tool,
            every request shows up here — including the ones that failed, which is usually what you
            want to see.
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Request</th>
                <th className="px-4 py-2 text-left font-medium">Result</th>
                <th className="px-4 py-2 text-left font-medium">Caller</th>
                <th className="px-4 py-2 text-left font-medium">Took</th>
                <th className="px-4 py-2 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <code className="text-xs">{requestLabel(row)}</code>
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
                    {requestCaller(row, keyNames, appNames)}
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
        Every request made with one of your API keys or by a connected app, newest first. Assistant
        tool calls show as <code className="text-xs">MCP</code> and the tool&rsquo;s name.
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
      ? 'Bad or missing credential'
      : status === 403
        ? 'Lacks the scope'
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
