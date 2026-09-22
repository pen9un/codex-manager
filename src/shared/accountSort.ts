import type { AccountSort, AccountSummary } from './types'

function remaining(account: AccountSummary): number | undefined {
  const windows = [account.usage?.primary, account.usage?.secondary].filter((item) => item !== undefined)
  return windows.length ? 100 - Math.max(...windows.map((item) => item.usedPercent)) : undefined
}
function timestamp(value?: string): number | undefined { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined }
function compareKnown(a: number | undefined, b: number | undefined, descending: boolean): number { if (a === undefined) return b === undefined ? 0 : 1; if (b === undefined) return -1; return descending ? b - a : a - b }

export function sortAccounts(accounts: AccountSummary[], sort: AccountSort): AccountSummary[] {
  return [...accounts].sort((a, b) => {
    const compared = sort === 'remaining' ? compareKnown(remaining(a), remaining(b), true)
      : sort === 'createdAt' ? compareKnown(timestamp(a.createdAt), timestamp(b.createdAt), true)
        : compareKnown(timestamp(a.subscriptionExpiresAt), timestamp(b.subscriptionExpiresAt), true)
    return compared || a.email.localeCompare(b.email)
  })
}
