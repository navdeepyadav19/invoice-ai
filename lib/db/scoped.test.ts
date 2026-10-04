import { describe, expect, it } from 'vitest'

import { scopedDb, scopePrelude, type ScopedClient } from './scoped'

const USER = '0b6f3c1e-9a43-4c1d-8a2e-1f5d7c9b2a10'

/** A pg client double that records every statement and can fail on demand. */
function fakeClient(options: { failOn?: RegExp; failRollback?: boolean } = {}) {
  const sent: string[] = []
  let released: unknown = 'not released'

  const client: ScopedClient = {
    async query(sql: string) {
      sent.push(sql)
      if (options.failRollback && sql === 'rollback') throw new Error('connection gone')
      if (options.failOn?.test(sql)) throw Object.assign(new Error('boom'), { code: '23505' })
      return { rows: [{ ok: 1 }], rowCount: 1, command: sql.startsWith('select') ? 'SELECT' : 'UPDATE' }
    },
    release(error?: Error | boolean) {
      released = error
    },
  }

  return { client, sent, released: () => released }
}

describe('scopePrelude', () => {
  it('switches role and pins the user id, transaction-locally', () => {
    expect(scopePrelude({ role: 'authenticated', userId: USER })).toBe(
      `set local role authenticated; select set_config('app.user_id', '${USER}', true)`,
    )
  })

  it('pins nothing for anon', () => {
    expect(scopePrelude({ role: 'anon' })).toBe('set local role anon')
  })

  // The id is spliced into SQL, so anything that is not a uuid must never get there.
  it('refuses a user id that is not a uuid', () => {
    expect(() => scopePrelude({ role: 'authenticated', userId: "x'); drop table invoices; --" })).toThrow(/uuid/)
  })
})

describe('scopedDb', () => {
  it('wraps a single statement in begin + prelude … commit', async () => {
    const fake = fakeClient()
    const db = scopedDb({ role: 'authenticated', userId: USER }, async () => fake.client)

    await db.selectFrom('invoices').selectAll().execute()

    expect(fake.sent).toHaveLength(3)
    expect(fake.sent[0]).toBe(`begin; ${scopePrelude({ role: 'authenticated', userId: USER })}`)
    expect(fake.sent[1]).toMatch(/^select \* from "invoices"/)
    expect(fake.sent[2]).toBe('commit')
    expect(fake.released()).toBeUndefined()
  })

  it('rolls back and rethrows the database error untouched', async () => {
    const fake = fakeClient({ failOn: /^update/ })
    const db = scopedDb({ role: 'authenticated', userId: USER }, async () => fake.client)

    await expect(db.updateTable('invoices').set({ notes: 'x' }).execute()).rejects.toMatchObject({ code: '23505' })
    expect(fake.sent.at(-1)).toBe('rollback')
    expect(fake.released()).toBeUndefined()
  })

  it('destroys the connection if even rollback fails', async () => {
    const fake = fakeClient({ failOn: /^update/, failRollback: true })
    const db = scopedDb({ role: 'authenticated', userId: USER }, async () => fake.client)

    await expect(db.updateTable('invoices').set({ notes: 'x' }).execute()).rejects.toThrow('boom')
    expect(fake.released()).toBeInstanceOf(Error)
  })

  it('runs the prelude once for an explicit transaction', async () => {
    const fake = fakeClient()
    const db = scopedDb({ role: 'authenticated', userId: USER }, async () => fake.client)

    await db.transaction().execute(async (trx) => {
      await trx.selectFrom('invoices').selectAll().execute()
      await trx.updateTable('invoices').set({ notes: 'x' }).execute()
    })

    expect(fake.sent[0]).toBe(`begin; ${scopePrelude({ role: 'authenticated', userId: USER })}`)
    expect(fake.sent.filter((sql) => sql.includes('set local role'))).toHaveLength(1)
    expect(fake.sent.at(-1)).toBe('commit')
  })

  it('reports affected rows for writes', async () => {
    const fake = fakeClient()
    const db = scopedDb({ role: 'authenticated', userId: USER }, async () => fake.client)

    const [result] = await db.updateTable('invoices').set({ notes: 'x' }).execute()
    expect(result.numUpdatedRows).toBe(BigInt(1))
  })
})
