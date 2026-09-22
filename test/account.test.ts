import { describe, expect, it } from 'vitest'
import { accountItems, activeAccountId, decodeJwtPayload, normalizeAccount, parseUsagePayload, statusOf, toCodexAuth, toImportBundle } from '../src/main/account'

const jwt = (payload: object): string => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`
const fixture = () => ({
  access_token: jwt({ client_id: 'client', exp: 4102444800, 'https://api.openai.com/profile': { email: 'test@example.com' }, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1', chatgpt_plan_type: 'pro' } }),
  id_token: jwt({ email: 'test@example.com' }), refresh_token: 'refresh'
})

describe('parseUsagePayload', () => {
  it('maps the Codex primary and secondary windows', () => {
    const usage = parseUsagePayload({ rate_limit: { primary_window: { used_percent: 13, limit_window_seconds: 604800, reset_at: 100 }, secondary_window: { used_percent: 4, limit_window_seconds: 18000 } }, credits: { balance: 7.5 } }, '2026-08-04T00:00:00.000Z')
    expect(usage.primary?.usedPercent).toBe(13)
    expect(usage.secondary?.windowSeconds).toBe(18000)
    expect(usage.credits?.balance).toBe(7.5)
  })
})

describe('account normalization', () => {
  it('derives display metadata without exposing tokens in summary state', () => {
    const account = normalizeAccount(fixture(), new Date('2026-01-01T00:00:00Z'))
    expect(account.email).toBe('test@example.com')
    expect(account.planType).toBe('pro')
    expect(account.clientId).toBe('client')
    expect(statusOf(account)).toBe('valid')
  })
  it('accepts Codex auth.json shape and serializes its contract', () => {
    const account = normalizeAccount({ auth_mode: 'chatgpt', tokens: { ...fixture(), account_id: 'acc-1' } })
    expect(toCodexAuth(account)).toMatchObject({ auth_mode: 'chatgpt', tokens: { account_id: 'acc-1', refresh_token: 'refresh' } })
  })
  it('rejects incomplete credentials', () => expect(() => normalizeAccount({ email: 'x@y.z' })).toThrow('缺少'))
  it('handles malformed JWTs safely', () => expect(decodeJwtPayload('bad')).toEqual({}))
  it('extracts credentials from a Sub2API export bundle', () => {
    const items = accountItems({ exported_at: 'now', accounts: [{ name: 'one', credentials: fixture() }] })
    expect(items).toHaveLength(1)
    expect(normalizeAccount(items[0]).email).toBe('test@example.com')
  })
  it('round-trips the manager export through the import parser', () => {
    const account = normalizeAccount(fixture())
    const bundle = toImportBundle([account], '2026-01-01T00:00:00.000Z')
    const items = accountItems(bundle)
    expect(normalizeAccount(items[0])).toMatchObject({ email: account.email, accountId: account.accountId, refreshToken: account.refreshToken })
  })
  it('matches the currently logged-in Codex account from auth.json claims', () => {
    const account = normalizeAccount(fixture())
    const auth = { tokens: { ...fixture(), account_id: 'unrelated-user-id' } }
    expect(activeAccountId(auth, [account])).toBe(account.id)
  })
})
