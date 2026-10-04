/**
 * Publish the generated Postman collection and environment to a Postman
 * workspace, creating them on the first run and replacing them after that.
 *
 * Why: the docs' "Run in Postman" button points at ONE collection in a public
 * workspace, and Postman keeps the button in step with that collection. So the
 * button stays current as long as the collection is replaced in place on every
 * API change — same uid, new contents — never re-created under a new uid.
 *
 * Matching is by name within the workspace, so nothing has to be stored
 * between runs: the first run creates, every later run finds and replaces.
 *
 * Pure apart from `fetch`, which is injected so tests need no network.
 */

const API = 'https://api.postman.com'

export interface PostmanEnvironmentFile {
  name: string
  values: { key: string; value: string; type?: string; enabled?: boolean }[]
}

export interface PostmanCollectionFile {
  info: { name: string }
  [key: string]: unknown
}

export interface SyncOptions {
  apiKey: string
  workspaceId: string
  collection: PostmanCollectionFile
  environment: PostmanEnvironmentFile
  fetch?: typeof fetch
}

export interface SyncResult {
  collection: { uid: string; action: 'created' | 'updated' }
  environment: { uid: string; action: 'created' | 'updated' }
}

type Kind = 'collection' | 'environment'

export async function syncToPostman(options: SyncOptions): Promise<SyncResult> {
  const { apiKey, workspaceId } = options
  if (!apiKey) throw new Error('POSTMAN_API_KEY is not set.')
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new Error('POSTMAN_WORKSPACE_ID must be the workspace UUID (Workspace → Info in Postman).')
  }

  const call = postmanClient(apiKey, options.fetch ?? fetch)

  const collection = await upsert(call, 'collection', workspaceId, options.collection.info.name, {
    collection: options.collection,
  })

  // `api_key` is published empty: whoever runs the button pastes their own.
  const environment = await upsert(call, 'environment', workspaceId, options.environment.name, {
    environment: {
      name: options.environment.name,
      values: options.environment.values.map((v) => ({
        key: v.key,
        value: v.type === 'secret' ? '' : v.value,
        type: v.type === 'secret' ? 'secret' : 'default',
        enabled: v.enabled ?? true,
      })),
    },
  })

  return { collection, environment }
}

async function upsert(
  call: ReturnType<typeof postmanClient>,
  kind: Kind,
  workspaceId: string,
  name: string,
  body: unknown,
): Promise<{ uid: string; action: 'created' | 'updated' }> {
  const plural = `${kind}s` as const
  const listed = (await call('GET', `/${plural}?workspace=${workspaceId}`)) as Record<
    string,
    { name: string; uid: string }[] | undefined
  >
  const matches = (listed[plural] ?? []).filter((item) => item.name === name)

  // Two with the same name means someone duplicated it by hand. Replacing
  // either would leave the button pointing at a coin flip, so stop instead.
  if (matches.length > 1) {
    throw new Error(`Workspace has ${matches.length} ${plural} named "${name}". Delete the extras, then re-run.`)
  }

  if (matches.length === 1) {
    const uid = matches[0].uid
    await call('PUT', `/${plural}/${uid}`, body)
    return { uid, action: 'updated' }
  }

  const created = (await call('POST', `/${plural}?workspace=${workspaceId}`, body)) as Record<Kind, { uid: string }>
  return { uid: created[kind].uid, action: 'created' }
}

function postmanClient(apiKey: string, fetchImpl: typeof fetch) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      // Postman's error body names the problem ("invalidWorkspace", …) and
      // never echoes the key, so it is safe to surface in CI logs.
      throw new Error(`Postman ${method} ${path.split('?')[0]} → ${response.status}: ${text.slice(0, 300)}`)
    }
    return text ? JSON.parse(text) : {}
  }
}
