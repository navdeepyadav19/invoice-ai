import { describe, expect, it } from 'vitest'

import { syncToPostman, type SyncOptions } from './sync'

const WORKSPACE = '1f0df51a-8658-4ee8-a2a1-d2567dfa09a9'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}

/** A fake Postman API: `existing` is what the workspace already holds. */
function fakePostman(existing: { collections?: object[]; environments?: object[] } = {}) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    }
    calls.push(call)

    const path = new URL(url).pathname
    let payload: unknown = {}
    if (call.method === 'GET') payload = { [path.slice(1)]: existing[path.slice(1) as 'collections'] ?? [] }
    if (call.method === 'POST') payload = { [path.slice(1, -1)]: { uid: `new-${path.slice(1, -1)}` } }
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

function options(fetchImpl: typeof fetch): SyncOptions {
  return {
    apiKey: 'PMAK-test',
    workspaceId: WORKSPACE,
    fetch: fetchImpl,
    collection: { info: { name: 'Invoice-AI API v1' }, item: [] },
    environment: {
      name: 'Invoice-AI — production',
      values: [
        { key: 'base_url', value: 'https://invoice.horizonpay.co/api/v1', enabled: true },
        { key: 'api_key', value: 'inv_live_should_never_be_published', type: 'secret', enabled: true },
      ],
    },
  }
}

describe('syncToPostman', () => {
  it('creates both in the workspace on the first run', async () => {
    const { impl, calls } = fakePostman()
    const result = await syncToPostman(options(impl))

    expect(result.collection).toEqual({ uid: 'new-collection', action: 'created' })
    expect(result.environment).toEqual({ uid: 'new-environment', action: 'created' })
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => c.url)).toEqual([
      `https://api.postman.com/collections?workspace=${WORKSPACE}`,
      `https://api.postman.com/environments?workspace=${WORKSPACE}`,
    ])
    expect(calls.every((c) => c.headers['x-api-key'] === 'PMAK-test')).toBe(true)
  })

  it('replaces in place when the names already exist, keeping the uid the button points at', async () => {
    const { impl, calls } = fakePostman({
      collections: [{ name: 'Invoice-AI API v1', uid: '123-col' }, { name: 'Something else', uid: '999' }],
      environments: [{ name: 'Invoice-AI — production', uid: '123-env' }],
    })
    const result = await syncToPostman(options(impl))

    expect(result.collection).toEqual({ uid: '123-col', action: 'updated' })
    expect(result.environment).toEqual({ uid: '123-env', action: 'updated' })
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'PUT /collections/123-col',
      'PUT /environments/123-env',
    ])
  })

  it('never publishes a secret value', async () => {
    const { impl, calls } = fakePostman()
    await syncToPostman(options(impl))

    const env = calls.find((c) => c.method === 'POST' && c.url.includes('/environments'))!.body as {
      environment: { values: { key: string; value: string; type: string }[] }
    }
    expect(env.environment.values.find((v) => v.key === 'api_key')).toMatchObject({ value: '', type: 'secret' })
    expect(JSON.stringify(calls)).not.toContain('inv_live_should_never_be_published')
  })

  it('refuses to guess between duplicates', async () => {
    const { impl } = fakePostman({
      collections: [
        { name: 'Invoice-AI API v1', uid: 'a' },
        { name: 'Invoice-AI API v1', uid: 'b' },
      ],
    })
    await expect(syncToPostman(options(impl))).rejects.toThrow(/2 collections named/)
  })

  it('rejects a missing key or a workspace that is not a UUID before calling Postman', async () => {
    const { impl, calls } = fakePostman()
    await expect(syncToPostman({ ...options(impl), apiKey: '' })).rejects.toThrow(/POSTMAN_API_KEY/)
    await expect(syncToPostman({ ...options(impl), workspaceId: 'my-workspace' })).rejects.toThrow(/UUID/)
    expect(calls).toHaveLength(0)
  })
})
