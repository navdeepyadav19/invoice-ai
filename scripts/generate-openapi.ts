/**
 * Write the OpenAPI document to api-docs/openapi.json for the Mintlify API
 * reference.
 *
 * The live spec at GET /api/v1/openapi.json is built from the same function,
 * so this file is a snapshot of it pinned to the production server URL. It is
 * committed, and CI regenerates it and fails on a diff — so the published
 * reference cannot drift from lib/api/openapi.ts.
 *
 *   lib/validators.ts → lib/api/openapi.ts → this script → api-docs/openapi.json
 *
 * Run with:  pnpm openapi:gen
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { buildOpenApiDocument, PRODUCTION_SERVER_URL } from '../lib/api/openapi'
import { codeSamples } from './sdk-gen/code-samples'
import { loadSpec, type Json } from './sdk-gen/spec'

const OUT_FILE = resolve(import.meta.dirname, '../api-docs/openapi.json')

function main(): void {
  const document = buildOpenApiDocument(PRODUCTION_SERVER_URL)

  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  // Second pass: TypeScript / Python / CLI snippets per operation, named by the
  // same rules the SDK generators use (so they can't drift from the SDKs).
  // Docs-only — the live /api/v1/openapi.json doesn't carry them.
  const paths = document.paths as Record<string, Record<string, Json>>
  for (const op of loadSpec(OUT_FILE).operations) {
    const operation = paths[op.path][op.method.toLowerCase()]
    const body = (operation.requestBody as Json | undefined)?.content as Json | undefined
    const example = (body?.['application/json'] as Json | undefined)?.example as Json | undefined
    operation['x-codeSamples'] = codeSamples(op, example)
  }

  // Pretty and newline-terminated so diffs are reviewable. Key order follows
  // the source, which is deterministic — no timestamps or random values.
  writeFileSync(OUT_FILE, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  const operations = Object.values(document.paths ?? {}).reduce(
    (sum, item) => sum + Object.keys(item ?? {}).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length,
    0,
  )
  console.log(`Wrote ${OUT_FILE.replace(resolve(import.meta.dirname, '..'), '.')} (${operations} operations).`)
}

main()
