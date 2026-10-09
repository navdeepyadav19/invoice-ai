import { describe, expect, it } from 'vitest'

import { SCOPES } from '@/lib/auth/scopes'
import { SCOPE_SHORT_LABELS, clientOrigin, requestCaller, requestLabel, scopeLabel } from './connected-apps'

describe('clientOrigin', () => {
  it('vouches for a CIMD client by the host of its client_id URL', () => {
    expect(
      clientOrigin({ client_kind: 'cimd', client_id_text: 'https://claude.ai/oauth/mcp-client.json' }),
    ).toEqual({ verified: true, host: 'claude.ai' })
  })

  it('keeps a non-default port, since that is part of who published it', () => {
    expect(clientOrigin({ client_kind: 'cimd', client_id_text: 'https://example.com:8443/c.json' })).toEqual({
      verified: true,
      host: 'example.com:8443',
    })
  })

  it('never vouches for a self-registered (DCR) client, whatever it calls itself', () => {
    expect(clientOrigin({ client_kind: 'dcr', client_id_text: 'oc_abcdefghijklmnopqrstuvwx' })).toEqual({
      verified: false,
    })
  })

  it('fails closed on a CIMD id that is not an https URL', () => {
    expect(clientOrigin({ client_kind: 'cimd', client_id_text: 'not a url' })).toEqual({ verified: false })
    expect(clientOrigin({ client_kind: 'cimd', client_id_text: 'http://example.com/c.json' })).toEqual({
      verified: false,
    })
  })
})

describe('scopeLabel', () => {
  it('has a short label for every scope', () => {
    for (const scope of SCOPES) expect(SCOPE_SHORT_LABELS[scope]).toBeTruthy()
  })

  it('shows an unknown stored scope as-is rather than hiding it', () => {
    expect(scopeLabel('invoices:read')).toBe('Read invoices')
    expect(scopeLabel('legacy:thing')).toBe('legacy:thing')
  })
})

describe('requestLabel', () => {
  it('shows a tool call as MCP <tool>', () => {
    expect(requestLabel({ method: 'MCP', route: 'mcp/list_invoices' })).toBe('MCP list_invoices')
  })

  it('leaves REST requests alone', () => {
    expect(requestLabel({ method: 'GET', route: '/api/v1/invoices' })).toBe('GET /api/v1/invoices')
  })
})

describe('requestCaller', () => {
  const keys = new Map([['key-1', 'Zapier']])
  const apps = new Map([['client-uuid-1', 'Claude']])

  it('names the API key', () => {
    expect(requestCaller({ via: 'api_key', api_key_id: 'key-1', client_id: null }, keys, apps)).toBe('Zapier')
    expect(requestCaller({ via: 'api_key', api_key_id: 'gone', client_id: null }, keys, apps)).toBe('Deleted key')
  })

  it('names the connected app for OAuth requests', () => {
    expect(requestCaller({ via: 'oauth', api_key_id: null, client_id: 'client-uuid-1' }, keys, apps)).toBe('Claude')
  })

  it('still says something when the app is no longer known', () => {
    expect(requestCaller({ via: 'oauth', api_key_id: null, client_id: 'gone' }, keys, apps)).toBe('Removed app')
    expect(requestCaller({ via: 'oauth', api_key_id: null, client_id: null }, keys, apps)).toBe('Removed app')
  })

  it('calls a session request "This browser"', () => {
    expect(requestCaller({ via: 'session', api_key_id: null, client_id: null }, keys, apps)).toBe('This browser')
  })
})
