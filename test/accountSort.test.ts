import { describe, expect, it } from 'vitest'
import { sortAccounts } from '../src/shared/accountSort'
import type { AccountSummary } from '../src/shared/types'

const account = (id: string, values: Partial<AccountSummary>): AccountSummary => ({ id, email: `${id}@example.com`, planType: 'pro', status: 'valid', isActive: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...values })

describe('account sorting', () => {
  it('uses the most constrained window and puts unknown usage last', () => {
    const values = [account('low', { usage: { primary: { usedPercent: 80 }, secondary: { usedPercent: 20 }, fetchedAt: 'now' } }), account('high', { usage: { primary: { usedPercent: 10 }, fetchedAt: 'now' } }), account('unknown', {})]
    expect(sortAccounts(values, 'remaining').map(item => item.id)).toEqual(['high', 'low', 'unknown'])
  })
  it('sorts creation newest first', () => expect(sortAccounts([account('old', {}), account('new', { createdAt: '2026-02-01T00:00:00Z' })], 'createdAt').map(item => item.id)).toEqual(['new', 'old']))
  it('sorts expiry farthest first and unknown last', () => expect(sortAccounts([account('late', { subscriptionExpiresAt: '2026-03-01T00:00:00Z' }), account('unknown', {}), account('soon', { subscriptionExpiresAt: '2026-02-01T00:00:00Z' })], 'subscriptionExpiresAt').map(item => item.id)).toEqual(['late', 'soon', 'unknown']))
})
