import { describe, expect, it } from 'vitest'
import { mergeLocalCredential } from '../src/main/codex'
import type { AccountCredential } from '../src/shared/types'

const account = (accountId: string, refreshToken: string): AccountCredential => ({
  id: `id-${accountId}`, email: `${accountId}@example.com`, planType: 'pro', accountId,
  accessToken: `access-${refreshToken}`, idToken: `id-${refreshToken}`, refreshToken,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  subscriptionExpiresAt: '2027-01-01T00:00:00Z', usage: { fetchedAt: '2026-01-02T00:00:00Z' }
})

describe('official Codex credential synchronization', () => {
  it('adopts newer local credentials without losing account metadata', () => {
    const stored = account('same', 'old'); const local = { ...account('same', 'new'), createdAt: 'later' }
    const merged = mergeLocalCredential(stored, local)
    expect(merged.refreshToken).toBe('new')
    expect(merged.createdAt).toBe(stored.createdAt)
    expect(merged.subscriptionExpiresAt).toBe(stored.subscriptionExpiresAt)
    expect(merged.usage).toBe(stored.usage)
  })
  it('never imports credentials belonging to another account', () => {
    const stored = account('first', 'old')
    expect(mergeLocalCredential(stored, account('second', 'new'))).toBe(stored)
  })
})
