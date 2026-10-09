import type { Metadata } from 'next'
import Link from 'next/link'

import { ConnectAssistant } from '@/components/settings/connect-assistant'
import { ConnectedApps } from '@/components/settings/connected-apps'
import { SetupWarning } from '@/components/settings/setup-warning'
import { listConnectedApps } from '@/lib/actions/oauth-grants'
import { apiSetupStatus } from '@/lib/api/setup-status'
import { mcpResourceUrl } from '@/lib/mcp/auth'

export const metadata: Metadata = { title: 'AI assistants' }

/**
 * Where people connect an assistant, and where they disconnect it.
 *
 * Connecting happens mostly in the assistant's own UI — this page only hands
 * over the URL and the steps. The approval itself is a separate consent screen
 * under /oauth. What only this page can do is show every app that currently
 * holds access, and take it away.
 */
export default async function AiAssistantsPage() {
  // An assistant's tokens are hashed with the same pepper as API keys and
  // checked against the same database, so the same misconfiguration breaks it.
  const setup = apiSetupStatus()
  const apps = await listConnectedApps()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium">AI assistants</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Claude, ChatGPT or another assistant to look up, draft and manage your invoices.
          It asks you to approve what it may do, and one-way actions — finalizing, sending, marking
          paid, voiding — always need your confirmation in the chat.
        </p>
      </div>

      {!setup.ready ? <SetupWarning missing={setup.missing} /> : null}

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Connect</h3>
        <ConnectAssistant mcpUrl={mcpResourceUrl()} />
      </section>

      <section className="space-y-3 border-t pt-8">
        <div>
          <h3 className="text-sm font-medium">Connected apps</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Revoking cuts an app off immediately. Its past requests stay in{' '}
            <Link href="/settings/activity" className="underline underline-offset-4">
              Activity
            </Link>
            .
          </p>
        </div>
        <ConnectedApps apps={apps} />
      </section>
    </div>
  )
}
