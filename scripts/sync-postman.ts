/**
 * Publish docs/platform/postman/* to the public Postman workspace that the
 * docs' "Run in Postman" button points at. See lib/postman/sync.ts.
 *
 *   POSTMAN_API_KEY=… POSTMAN_WORKSPACE_ID=… pnpm postman:sync
 *
 * Runs in CI (.github/workflows/postman-sync.yml) after every change to the
 * generated files on main. Run `pnpm postman:gen` first if the API changed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { syncToPostman } from '../lib/postman/sync'

const dir = resolve(__dirname, '../docs/platform/postman')
const read = (file: string) => JSON.parse(readFileSync(resolve(dir, file), 'utf8'))

async function main() {
  const result = await syncToPostman({
    apiKey: process.env.POSTMAN_API_KEY ?? '',
    workspaceId: process.env.POSTMAN_WORKSPACE_ID ?? '',
    collection: read('invoice-ai.postman_collection.json'),
    environment: read('invoice-ai.postman_environment.json'),
  })

  console.log(`collection  ${result.collection.action}  ${result.collection.uid}`)
  console.log(`environment ${result.environment.action}  ${result.environment.uid}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
