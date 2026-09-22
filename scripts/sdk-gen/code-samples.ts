/**
 * TypeScript, Python and CLI snippets for every operation, attached to
 * api-docs/openapi.json as `x-codeSamples` so each Mintlify API page shows how
 * to make the call with our own tools, not only with curl.
 *
 * Built from the same `loadSpec()` naming the SDK generators use, so a snippet
 * can never name a method the SDK doesn't have. Request bodies come from the
 * operation's own `example` in the spec.
 */

import type { Json, SpecOperation } from './spec'

export interface CodeSample {
  lang: string
  label: string
  source: string
}

/** Placeholder ids for path params, shaped like the real prefixes. */
const EXAMPLE_IDS: Record<string, string> = {
  customers: 'cus_Nf3kQ8pR2mX7vB1cT9wL4sZ6',
  products: 'prod_Jc5Tn8Wq1Ze6Ra3Ym',
  prices: 'price_Jc5Tn8Wq1Ze6Ra3Ym9Ub2Gs7',
  invoices: 'in_Mx4Hb7Pz2Kq9Tr5Wn1Lc8Vd3',
  invoiceItems: 'ii_Qa6Ze2Rt8Yp4Uk1Mh7Bn3Xs9',
  webhookEndpoints: '5b1e9f4e-2c3a-4d7b-9a61-0f2e8c4d7a13',
}

/**
 * CLI commands for operations without a request body. Anything not listed —
 * and every call with a body — uses `invoice-ai api`, which works for every
 * endpoint and reads naturally next to the curl example.
 */
const CLI_GROUP: Record<string, string> = {
  customers: 'customers',
  products: 'products',
  prices: 'prices',
  invoices: 'invoices',
  webhookEndpoints: 'webhooks',
}
const CLI_VERB: Record<string, string> = {
  list: 'list',
  retrieve: 'get',
  del: 'delete',
  archive: 'archive',
  finalize: 'finalize',
  pdf: 'pdf',
  events: 'events',
}

export function codeSamples(op: SpecOperation, example: Json | undefined): CodeSample[] {
  const id = op.pathParams.length ? EXAMPLE_IDS[op.resource.property] ?? 'id' : undefined
  const body = op.hasBody ? example ?? {} : undefined
  return [
    { lang: 'typescript', label: 'TypeScript', source: typescript(op, id, body) },
    { lang: 'python', label: 'Python', source: python(op, id, body) },
    { lang: 'bash', label: 'CLI', source: cli(op, id, body) },
  ]
}

function typescript(op: SpecOperation, id: string | undefined, body: Json | undefined): string {
  const args = [id && `'${id}'`, body && Object.keys(body).length ? js(body) : undefined].filter(Boolean)
  const call = `invoiceai.${op.resource.property}.${op.sdkMethod}(${args.join(', ')})`
  const use =
    op.kind === 'page'
      ? `for await (const item of ${call}) {\n  console.log(item.id)\n}`
      : op.kind === 'void'
        ? `await ${call}`
        : op.kind === 'binary'
          ? `const pdf = await ${call}`
          : `const result = await ${call}`
  return `import InvoiceAI from '@horizonpay/invoice-ai'\n\nconst invoiceai = new InvoiceAI() // reads INVOICE_AI_API_KEY\n\n${use}`
}

function python(op: SpecOperation, id: string | undefined, body: Json | undefined): string {
  const method = op.sdkMethod === 'del' ? 'delete' : snake(op.sdkMethod)
  const kwargs = body ? Object.entries(body).map(([k, v]) => `    ${k}=${py(v, 1)},`) : []
  const args = id ? [`"${id}"`] : []
  const inner = kwargs.length ? `\n${[...args.map((a) => `    ${a},`), ...kwargs].join('\n')}\n` : args.join(', ')
  const call = `client.${op.resource.snake}.${method}(${inner})`
  const use =
    op.kind === 'page'
      ? `for item in ${call}:\n    print(item.id)`
      : op.kind === 'void'
        ? call
        : op.kind === 'binary'
          ? `pdf = ${call}`
          : `result = ${call}`
  return `from invoice_ai import InvoiceAI\n\nclient = InvoiceAI()  # reads INVOICE_AI_API_KEY\n\n${use}`
}

function cli(op: SpecOperation, id: string | undefined, body: Json | undefined): string {
  const group = CLI_GROUP[op.resource.property]
  const verb = CLI_VERB[op.sdkMethod]
  if (!body && group && verb) return ['invoice-ai', group, verb, id].filter(Boolean).join(' ')
  const path = id ? op.path.replace(/\{[^}]+\}/, id) : op.path
  const data = body && Object.keys(body).length ? ` \\\n  -d '${JSON.stringify(body)}'` : ''
  return `invoice-ai api ${op.method} ${path}${data}`
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

/** A JS object literal with unquoted keys, 2-space indented. */
function js(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth + 1)
  const end = '  '.repeat(depth)
  if (Array.isArray(value)) return `[\n${value.map((v) => `${pad}${js(v, depth + 1)},`).join('\n')}\n${end}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Json).map(([k, v]) => `${pad}${/^[a-z_][a-z0-9_]*$/i.test(k) ? k : `'${k}'`}: ${js(v, depth + 1)},`)
    return `{\n${entries.join('\n')}\n${end}}`
  }
  return typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value)
}

/** A Python literal (dicts use JSON-style keys, which Python accepts). */
function py(value: unknown, depth = 0): string {
  const pad = '    '.repeat(depth + 1)
  const end = '    '.repeat(depth)
  if (Array.isArray(value)) return `[\n${value.map((v) => `${pad}${py(v, depth + 1)},`).join('\n')}\n${end}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Json).map(([k, v]) => `${pad}"${k}": ${py(v, depth + 1)},`)
    return `{\n${entries.join('\n')}\n${end}}`
  }
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}
