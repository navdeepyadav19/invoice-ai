/**
 * Exercises the 0017 payments functions against a real database, inside one
 * transaction that is ROLLED BACK at the end: nothing is left behind.
 *
 *   pnpm tsx scripts/check-payments-ledger.ts
 *
 * Uses DATABASE_URL_UNPOOLED from .env.local (the dev branch). Refuses to run
 * when that URL is the production endpoint name in PROD_DB_HOST, if set.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

import { normaliseSsl } from '../lib/db/url'

const ROOT = resolve(import.meta.dirname, '..')
if (existsSync(resolve(ROOT, '.env.local'))) process.loadEnvFile(resolve(ROOT, '.env.local'))

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set.')
if (process.env.PROD_DB_HOST && url.includes(process.env.PROD_DB_HOST)) throw new Error('Refusing to run against production.')

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`)
}

async function main() {
  const db = new Client({ connectionString: normaliseSsl(url!) })
  await db.connect()
  try {
    await db.query('begin')

    const { rows: users } = await db.query(`select b.owner_id, b.id as business_id from public.businesses b limit 1`)
    if (!users[0]) throw new Error('Need at least one business on this branch.')
    const { owner_id: owner, business_id: business } = users[0]

    async function newInvoice(total: number, status = 'open') {
      const { rows } = await db.query(
        `insert into public.invoices (owner_id, business_id, status, currency, total, place_of_supply_state_code, invoice_number, sent_at)
         values ($1, $2, $3, 'USD', $4, '00', 'LEDGER-TEST-' || substr(md5(random()::text), 1, 8), now()) returning id`,
        [owner, business, status, total],
      )
      return rows[0].id as string
    }
    const inv = async (id: string) =>
      (await db.query(`select status, amount_paid::float, amount_credited::float, (paid_at is not null) as has_paid_at from public.invoices where id = $1`, [id])).rows[0]
    const asUser = async () => {
      await db.query(`set local role authenticated`)
      await db.query(`select set_config('app.user_id', $1, true)`, [owner])
    }
    const asOwner = async () => db.query('reset role')

    // 1. Manual partial payment, then the rest.
    const a = await newInvoice(1000)
    await asUser()
    await db.query(`select public.record_manual_payment($1, 400, null, 'ACH 1')`, [a])
    check('partial payment keeps invoice open', await inv(a), { status: 'open', amount_paid: 400, amount_credited: 0, has_paid_at: false })
    await db.query(`select public.record_manual_payment($1, null, null, 'ACH 2')`, [a])
    check('null amount pays the balance and marks paid', await inv(a), { status: 'paid', amount_paid: 1000, amount_credited: 0, has_paid_at: true })
    const events = (await db.query(`select type::text from public.invoice_events where invoice_id = $1 order by created_at, id`, [a])).rows.map((r) => r.type)
    check('events: two payment_succeeded + one paid', events.sort(), ['paid', 'payment_succeeded', 'payment_succeeded'])

    // 2. Manual overpay is refused.
    const b = await newInvoice(500)
    let refused = false
    await db.query('savepoint s1')
    try { await db.query(`select public.record_manual_payment($1, 600, null, null)`, [b]) } catch { refused = true }
    await db.query('rollback to savepoint s1')
    check('manual payment above balance is refused', refused, true)

    // 3. Provider payment: idempotent replay and overpayment flag.
    await asOwner()
    const c = await newInvoice(100)
    const pay = (amount: number, ext: string) =>
      db.query(`select public._apply_payment($1, 'stripe', 'test', $2, 'usd', null, null, $3, 'cs_1', 'ch_1', 'acct_1', 'card', null, '{}'::jsonb) as r`, [c, amount, ext])
    const first = (await pay(150, 'pi_1')).rows[0].r
    check('overpayment applies only the balance', [first.amount_applied, first.needs_attention, first.invoice_status], [100, 'overpaid', 'paid'])
    const replay = (await pay(150, 'pi_1')).rows[0].r
    check('replayed provider payment is not counted twice', [replay.replayed, (await inv(c)).amount_paid], [true, 100])
    check('test payment flags the invoice', (await db.query(`select has_test_payments from public.invoices where id = $1`, [c])).rows[0].has_test_payments, true)

    // 4. Refund: first out of the unapplied excess, invoice unchanged.
    const paymentC = first.payment_id
    await db.query(`select public._apply_refund($1, 50, 'overpaid', false, 're_1', null, '{}'::jsonb)`, [paymentC])
    check('refunding the excess leaves the invoice paid', await inv(c), { status: 'paid', amount_paid: 100, amount_credited: 0, has_paid_at: true })

    // 5. Refund applied money, client still owes -> reopens.
    await db.query(`select public._apply_refund($1, 40, 'duplicate', true, 're_2', null, '{}'::jsonb)`, [paymentC])
    check('refund with client_still_owes reopens the balance', await inv(c), { status: 'open', amount_paid: 60, amount_credited: 0, has_paid_at: false })

    // 6. Refund applied money, client does not owe -> credited, stays settled.
    const d = await newInvoice(200)
    const pd = (await db.query(`select public._apply_payment($1, 'stripe', 'live', 200, 'USD', null, null, 'pi_2', null, null, 'acct_1', 'card', null, '{}'::jsonb) as r`, [d])).rows[0].r
    await db.query(`select public._apply_refund($1, 200, 'job cancelled', false, 're_3', null, '{}'::jsonb)`, [pd.payment_id])
    check('full refund without debt -> credited, stays paid', await inv(d), { status: 'paid', amount_paid: 0, amount_credited: 200, has_paid_at: true })
    const replayRefund = (await db.query(`select public._apply_refund($1, 200, 'x', false, 're_3', null, '{}'::jsonb) as r`, [pd.payment_id])).rows[0].r
    check('replayed refund is ignored', replayRefund.replayed, true)

    // 7. Payment on a void invoice is recorded but not applied.
    const e = await newInvoice(300, 'void')
    const pe = (await db.query(`select public._apply_payment($1, 'stripe', 'live', 300, 'USD', null, null, 'pi_3', null, null, 'acct_1', 'card', null, '{}'::jsonb) as r`, [e])).rows[0].r
    check('payment on void invoice is flagged, not applied', [pe.amount_applied, pe.needs_attention], [0, 'invoice_void'])

    // 8. Currency mismatch is flagged.
    const f = await newInvoice(300)
    const pf = (await db.query(`select public._apply_payment($1, 'stripe', 'live', 300, 'EUR', null, null, 'pi_4', null, null, 'acct_1', 'card', null, '{}'::jsonb) as r`, [f])).rows[0].r
    check('currency mismatch is flagged', [pf.amount_applied, pf.needs_attention], [0, 'currency_mismatch'])

    // 9. Voiding an invoice that holds money is impossible.
    let voidBlocked = false
    await db.query('savepoint s2')
    try { await db.query(`update public.invoices set status = 'void' where id = $1`, [a]) } catch { voidBlocked = true }
    await db.query('rollback to savepoint s2')
    check('cannot void an invoice that holds money', voidBlocked, true)

    // 10. Authenticated users cannot write payments directly.
    await asUser()
    let directBlocked = false
    await db.query('savepoint s3')
    try { await db.query(`insert into public.payments (owner_id, invoice_id, provider, amount, currency) values ($1, $2, 'manual', 1, 'USD')`, [owner, b]) } catch { directBlocked = true }
    await db.query('rollback to savepoint s3')
    check('direct INSERT into payments is denied', directBlocked, true)
  } finally {
    await db.query('rollback')
    await db.end()
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed (rolled back).')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
