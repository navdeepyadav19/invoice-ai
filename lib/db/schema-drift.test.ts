import type { Selectable } from 'kysely'
import { describe, expectTypeOf, it } from 'vitest'

import type * as Rows from '@/lib/database.types'
import type { DB } from './schema'

/**
 * lib/database.types.ts (hand-written, what the UI imports) and lib/db/schema.ts
 * (generated from the live database) describe the same tables. These checks run
 * under `pnpm typecheck`: add a column in a migration, regenerate schema.ts, and
 * this fails until the Row type gains the column too.
 */

type Columns<T extends keyof DB> = keyof Selectable<DB[T]>

describe('row types match the generated schema', () => {
  it('has the same columns, table by table', () => {
    expectTypeOf<keyof Rows.ProfileRow>().toEqualTypeOf<Columns<'profiles'>>()
    expectTypeOf<keyof Rows.EmailVerificationRow>().toEqualTypeOf<Columns<'email_verifications'>>()
    expectTypeOf<keyof Rows.BusinessRow>().toEqualTypeOf<Columns<'businesses'>>()
    expectTypeOf<keyof Rows.ClientRow>().toEqualTypeOf<Columns<'clients'>>()
    expectTypeOf<keyof Rows.InvoiceRow>().toEqualTypeOf<Columns<'invoices'>>()
    expectTypeOf<keyof Rows.InvoiceItemRow>().toEqualTypeOf<Columns<'invoice_items'>>()
    expectTypeOf<keyof Rows.InvoiceEventRow>().toEqualTypeOf<Columns<'invoice_events'>>()
    expectTypeOf<keyof Rows.ProductRow>().toEqualTypeOf<Columns<'products'>>()
    expectTypeOf<keyof Rows.PriceRow>().toEqualTypeOf<Columns<'prices'>>()
    expectTypeOf<keyof Rows.ApiKeyRow>().toEqualTypeOf<Columns<'api_keys'>>()
    expectTypeOf<keyof Rows.CliDeviceCodeRow>().toEqualTypeOf<Columns<'cli_device_codes'>>()
    expectTypeOf<keyof Rows.OAuthClientRow>().toEqualTypeOf<Columns<'oauth_clients'>>()
    expectTypeOf<keyof Rows.OAuthGrantRow>().toEqualTypeOf<Columns<'oauth_grants'>>()
    expectTypeOf<keyof Rows.OAuthAuthorizationCodeRow>().toEqualTypeOf<Columns<'oauth_authorization_codes'>>()
    expectTypeOf<keyof Rows.OAuthTokenRow>().toEqualTypeOf<Columns<'oauth_tokens'>>()
    expectTypeOf<keyof Rows.IdempotencyKeyRow>().toEqualTypeOf<Columns<'idempotency_keys'>>()
    expectTypeOf<keyof Rows.WebhookEndpointRow>().toEqualTypeOf<Columns<'webhook_endpoints'>>()
    expectTypeOf<keyof Rows.WebhookDeliveryRow>().toEqualTypeOf<Columns<'webhook_deliveries'>>()
    expectTypeOf<keyof Rows.ApiRequestRow>().toEqualTypeOf<Columns<'api_requests'>>()
    expectTypeOf<keyof Rows.PaymentConnectionRow>().toEqualTypeOf<Columns<'payment_connections'>>()
    expectTypeOf<keyof Rows.PaymentRow>().toEqualTypeOf<Columns<'payments'>>()
    expectTypeOf<keyof Rows.RefundRow>().toEqualTypeOf<Columns<'refunds'>>()
    expectTypeOf<keyof Rows.InvoiceCreditRow>().toEqualTypeOf<Columns<'invoice_credits'>>()
    expectTypeOf<keyof Rows.CheckoutSessionRow>().toEqualTypeOf<Columns<'checkout_sessions'>>()
    expectTypeOf<keyof Rows.ProviderEventRow>().toEqualTypeOf<Columns<'provider_events'>>()
  })
})
