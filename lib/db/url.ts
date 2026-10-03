/**
 * Neon hands out `sslmode=require`. node-postgres treats that as verify-full
 * already and warns that the meaning will change; say what we mean instead.
 * `channel_binding` is a libpq option pg doesn't understand, so it goes too.
 */
export function normaliseSsl(url: string): string {
  const parsed = new URL(url)
  if (parsed.searchParams.get('sslmode') === 'require') parsed.searchParams.set('sslmode', 'verify-full')
  parsed.searchParams.delete('channel_binding')
  return parsed.toString()
}
