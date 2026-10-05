import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The action is thin, so these pin the parts that are easy to get wrong: it
 * runs as the signed-in user's db (never the owner connection), a false from
 * the database is reported rather than swallowed, and junk ids never reach SQL.
 */

const userDbHandle = { tag: 'userDb' }
const revalidatePath = vi.fn()
const oauthRevokeGrant = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/queries', () => ({ requireUser: vi.fn(async () => ({ id: 'user-1' })) }))
vi.mock('@/lib/auth/context', () => ({
  contextFromSession: vi.fn(async () => ({ userId: 'user-1', db: userDbHandle, via: 'session' })),
}))
vi.mock('@/lib/db/rpc', () => ({
  oauthRevokeGrant: (...a: unknown[]) => oauthRevokeGrant(...a),
  oauthListGrants: vi.fn(),
}))

const { revokeConnectedAppAction } = await import('./oauth-grants')

const GRANT = '3f1c2b4a-1111-4222-8333-944455556666'

beforeEach(() => {
  revalidatePath.mockReset()
  oauthRevokeGrant.mockReset()
})

describe('revokeConnectedAppAction', () => {
  it('revokes through the RLS-scoped db and refreshes the page', async () => {
    oauthRevokeGrant.mockResolvedValue(true)

    await expect(revokeConnectedAppAction(GRANT)).resolves.toEqual({})
    expect(oauthRevokeGrant).toHaveBeenCalledWith(userDbHandle, GRANT)
    expect(revalidatePath).toHaveBeenCalledWith('/settings/ai-assistants')
  })

  it('says so when the grant was not revoked (not yours, or already gone)', async () => {
    oauthRevokeGrant.mockResolvedValue(false)

    const result = await revokeConnectedAppAction(GRANT)
    expect(result.error).toMatch(/already disconnected/)
  })

  it('turns away a non-uuid without touching the database', async () => {
    const result = await revokeConnectedAppAction("x'; drop table oauth_grants; --")
    expect(result.error).toBeTruthy()
    expect(oauthRevokeGrant).not.toHaveBeenCalled()
  })

  it('maps an unexpected failure to a friendly message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    oauthRevokeGrant.mockRejectedValue(new Error('connection reset'))

    const result = await revokeConnectedAppAction(GRANT)
    expect(result.error).toBe('Something went wrong. Please try again.')
    expect(revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
