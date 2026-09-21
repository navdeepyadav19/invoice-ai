import 'server-only'

/**
 * Is the API actually usable on this deployment?
 *
 * Without this check the failure is silent and baffling: the settings page
 * happily creates a key, shows it once, tells you to copy it — and then every
 * single request with it returns 401, because the server has no pepper to hash
 * against or no signing key to mint a token with. The user has no way to tell
 * a misconfigured deployment from a wrong key.
 *
 * So the UI asks first, and says so plainly before anyone wastes an afternoon.
 */

export interface SetupStatus {
  ready: boolean
  missing: { name: string; why: string }[]
}

export function apiSetupStatus(): SetupStatus {
  const missing: SetupStatus['missing'] = []

  if (!process.env.API_KEY_PEPPER) {
    missing.push({
      name: 'API_KEY_PEPPER',
      why: 'Keys are hashed with this. Without it no key can be created or verified.',
    })
  }

  const hasKey =
    process.env.SUPABASE_JWT_PRIVATE_KEY_JWK || process.env.SUPABASE_JWT_PRIVATE_KEY

  if (!hasKey || !process.env.SUPABASE_JWT_KID) {
    missing.push({
      name: 'SUPABASE_JWT_PRIVATE_KEY_JWK + SUPABASE_JWT_KID',
      why: 'Used to mint the short-lived token each API request runs under, so row-level security still applies.',
    })
  }

  return { ready: missing.length === 0, missing }
}

export interface WebhookSetupStatus {
  ready: boolean
  reason?: string
}

/**
 * Registering an endpoint works without these, but nothing is ever delivered —
 * rows just pile up in the outbox. Worth saying out loud on the webhooks page.
 */
export function webhookSetupStatus(): WebhookSetupStatus {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ready: false,
      reason:
        'SUPABASE_SERVICE_ROLE_KEY is not set, so the delivery worker cannot read the queue. Events are being recorded but nothing is being sent.',
    }
  }

  if (!process.env.CRON_SECRET) {
    return {
      ready: false,
      reason:
        'CRON_SECRET is not set, so the delivery worker refuses every request — including the scheduler’s. Events are queued but never sent.',
    }
  }

  return { ready: true }
}
