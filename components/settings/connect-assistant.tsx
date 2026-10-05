'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * One tab per assistant, because every client hides "add an MCP server" in a
 * different place and the setup that works in one is wrong in another.
 *
 * Menu names below come from each vendor's own docs at the time of writing.
 * They rename things often, so the steps name the destination ("Connectors")
 * and the exact values to paste, which outlive a menu reshuffle; the values are
 * what people actually get wrong.
 *
 * Every snippet is built from the one URL the server passes in, so a preview
 * deployment shows its own address rather than production's.
 */
export function ConnectAssistant({ mcpUrl }: { mcpUrl: string }) {
  const cursorConfig = JSON.stringify({ mcpServers: { 'invoice-ai': { url: mcpUrl } } }, null, 2)
  const cursorKeyConfig = JSON.stringify(
    { mcpServers: { 'invoice-ai': { url: mcpUrl, headers: { Authorization: 'Bearer inv_live_…' } } } },
    null,
    2,
  )

  return (
    <Tabs defaultValue="claude">
      {/* Five labels don't fit a phone; let the strip scroll rather than wrap. */}
      <div className="overflow-x-auto pb-1">
        <TabsList>
          <TabsTrigger value="claude">Claude</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="cursor">Cursor</TabsTrigger>
          <TabsTrigger value="other">Other</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="claude" className="space-y-4 pt-2">
        <p className="text-xs text-muted-foreground">claude.ai and Claude Desktop share connectors.</p>
        <Steps>
          <Step>
            Open <Menu>Customize → Connectors</Menu> (on some versions it&rsquo;s under{' '}
            <Menu>Settings → Connectors</Menu>).
          </Step>
          <Step>
            Choose <Menu>Add custom connector</Menu> and name it <Menu>Invoice-AI</Menu>.
          </Step>
          <Step>
            Paste this as the server URL:
            <Snippet value={mcpUrl} />
          </Step>
          <Step>
            Add it, then <Menu>Connect</Menu>. Claude sends you here to approve what it may do.
          </Step>
        </Steps>
        <Note>
          On a Team or Enterprise plan, an owner adds the connector once in the organisation&rsquo;s
          connector settings; each person then connects their own account.
        </Note>
      </TabsContent>

      <TabsContent value="chatgpt" className="space-y-4 pt-2">
        <Steps>
          <Step>
            In <Menu>Settings</Menu>, open the connectors section (<Menu>Apps &amp; Connectors</Menu>)
            → <Menu>Advanced settings</Menu> and turn on <Menu>Developer mode</Menu>.
          </Step>
          <Step>
            Back in that section, choose <Menu>Create</Menu> and name it <Menu>Invoice-AI</Menu>.
          </Step>
          <Step>
            Use this as the MCP server URL, with <Menu>OAuth</Menu> as the authentication:
            <Snippet value={mcpUrl} />
          </Step>
          <Step>Create it. ChatGPT sends you here to sign in and approve what it may do.</Step>
        </Steps>
        <Note>Developer mode isn&rsquo;t available on every ChatGPT plan.</Note>
      </TabsContent>

      <TabsContent value="claude-code" className="space-y-4 pt-2">
        <Steps>
          <Step>
            Add the server:
            <Snippet value={`claude mcp add --transport http invoice-ai ${mcpUrl}`} />
          </Step>
          <Step>
            Run <Menu>/mcp</Menu> inside Claude Code and pick <Menu>invoice-ai</Menu> to sign in. Your
            browser opens here to approve it.
          </Step>
        </Steps>
        <Note>
          Rather use an <Link href="/settings/api-keys" className="underline underline-offset-4">API key</Link>
          ? Skip the sign-in and pass it as a header instead:
        </Note>
        <Snippet
          value={`claude mcp add --transport http invoice-ai ${mcpUrl} \\\n  --header "Authorization: Bearer inv_live_…"`}
        />
      </TabsContent>

      <TabsContent value="cursor" className="space-y-4 pt-2">
        <Steps>
          <Step>
            Add this to <Menu>~/.cursor/mcp.json</Menu> (or <Menu>.cursor/mcp.json</Menu> in one
            project):
            <Snippet value={cursorConfig} />
          </Step>
          <Step>Connect it from Cursor&rsquo;s MCP settings. Cursor sends you here to approve it.</Step>
        </Steps>
        <Note>Or skip the sign-in with an API key:</Note>
        <Snippet value={cursorKeyConfig} />
      </TabsContent>

      <TabsContent value="other" className="space-y-4 pt-2">
        <p className="text-sm">
          Any assistant that supports remote MCP servers over HTTP can connect to:
        </p>
        <Snippet value={mcpUrl} />
        <p className="text-xs text-muted-foreground">
          If it supports OAuth, it will send you here to approve it. If it doesn&rsquo;t, create an{' '}
          <Link href="/settings/api-keys" className="underline underline-offset-4">
            API key
          </Link>{' '}
          with the &ldquo;AI assistant&rdquo; preset and send it as a Bearer token:{' '}
          <code className="text-[11px]">Authorization: Bearer inv_live_…</code>
        </p>
      </TabsContent>
    </Tabs>
  )
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-3 pl-5 text-sm marker:text-muted-foreground">{children}</ol>
}

function Step({ children }: { children: ReactNode }) {
  return <li className="space-y-2 pl-1">{children}</li>
}

/** A menu item or value to type, set apart so it can be scanned for. */
function Menu({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

/**
 * A value with a copy button. Retyping a URL is how a connector ends up
 * pointing at "invoice-ai.app/mpc"; copying removes the chance.
 */
function Snippet({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
        {value}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  )
}
