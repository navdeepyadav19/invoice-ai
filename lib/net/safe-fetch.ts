import { request as httpsRequest } from 'node:https'

import { assertSafeUrl, pinnedLookup } from '@/lib/webhooks/deliver'

/**
 * GET a small JSON document from a URL someone else chose — safely.
 *
 * The authorization server fetches a client's metadata from the URL in its
 * `client_id` (Client ID Metadata Documents). That URL is attacker-controlled,
 * so this is the same server-side request forgery problem webhook delivery
 * already solved (lib/webhooks/deliver.ts), and it reuses that guard:
 *
 *   - https only, no credentials in the URL
 *   - every DNS answer checked at connect time, so a rebinding resolver
 *     can't swap in 169.254.169.254 or 127.0.0.1 after the check
 *   - redirects are not followed
 *   - a byte cap and a timeout, so a slow or huge reply can't tie us up
 */
export async function safeGetJson(
  url: string,
  { maxBytes = 8192, timeoutMs = 5000 }: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ ok: true; body: unknown; maxAgeSeconds: number | null } | { ok: false; reason: string }> {
  const guard = await assertSafeUrl(url)
  if (!guard.ok) return guard

  return new Promise((resolve) => {
    let settled = false
    const done = (result: Awaited<ReturnType<typeof safeGetJson>>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const req = httpsRequest(
      url,
      { method: 'GET', headers: { accept: 'application/json' }, lookup: pinnedLookup, agent: false },
      (response) => {
        const status = response.statusCode ?? 0
        if (status !== 200) {
          response.destroy()
          return done({ ok: false, reason: `Metadata URL answered ${status}.` })
        }

        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            response.destroy()
            return done({ ok: false, reason: `Metadata document is larger than ${maxBytes} bytes.` })
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const maxAge = /max-age=(\d+)/.exec(response.headers['cache-control'] ?? '')
            done({ ok: true, body, maxAgeSeconds: maxAge ? Number(maxAge[1]) : null })
          } catch {
            done({ ok: false, reason: 'Metadata document is not valid JSON.' })
          }
        })
        response.on('error', () => done({ ok: false, reason: 'Could not read the metadata document.' }))
      },
    )

    const timer = setTimeout(() => {
      req.destroy()
      done({ ok: false, reason: 'Metadata URL did not answer in time.' })
    }, timeoutMs)

    req.on('error', (cause) => done({ ok: false, reason: cause.message || 'Could not fetch the metadata document.' }))
    req.end()
  })
}
