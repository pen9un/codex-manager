import { createHash, randomUUID } from 'node:crypto'
import type { AccountCredential, AccountProfile, AccountStatus, AccountSummary, AccountUsage, UsageWindow } from '../shared/types'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('账号数据必须是 JSON 对象')
  return value as JsonRecord
}
const text = (source: JsonRecord, ...keys: string[]): string | undefined => {
  for (const key of keys) if (typeof source[key] === 'string' && source[key]) return source[key] as string
  return undefined
}
const number = (source: JsonRecord, ...keys: string[]): number | undefined => {
  for (const key of keys) if (typeof source[key] === 'number' && Number.isFinite(source[key])) return source[key] as number
  return undefined
}

export function accountItems(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  const source = record(input)
  if (!Array.isArray(source.accounts)) return [source]
  return source.accounts.map((item, index) => {
    const entry = record(item)
    if (!entry.credentials || typeof entry.credentials !== 'object') throw new Error(`accounts[${index}] 缺少 credentials`)
    return { ...record(entry.credentials), extra: entry.extra }
  })
}

export function decodeJwtPayload(token?: string): JsonRecord {
  if (!token) return {}
  try { return record(JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'))) } catch { return {} }
}

function importedUsage(value: unknown): AccountUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const extra = record(value)
  const window = (prefix: string): UsageWindow | undefined => {
    const usedPercent = number(extra, `${prefix}_used_percent`)
    if (usedPercent === undefined) return undefined
    return { usedPercent, windowSeconds: number(extra, `${prefix}_window_seconds`), resetsAt: number(extra, `${prefix}_reset_at`) }
  }
  const primary = window('codex_primary') || window('codex_7d')
  const secondary = window('codex_secondary') || window('codex_5h')
  if (!primary && !secondary) return undefined
  return { primary, secondary, planType: text(extra, 'plan_type'), fetchedAt: text(extra, 'codex_usage_updated_at') || new Date().toISOString() }
}

function profileOf(source: JsonRecord, claims: JsonRecord, authData: JsonRecord): AccountProfile {
  const organizations = Array.isArray(authData.organizations) ? authData.organizations : []
  const selected = organizations.find(item => item && typeof item === 'object' && (item as JsonRecord).is_default === true) || organizations[0]
  const organization = selected && typeof selected === 'object' ? record(selected) : {}
  return {
    authProvider: text(source, 'auth_provider') || text(claims, 'auth_provider'),
    emailVerified: typeof claims.email_verified === 'boolean' ? claims.email_verified : undefined,
    organizationTitle: text(organization, 'title'), organizationRole: text(organization, 'role'),
    computeResidency: text(authData, 'chatgpt_compute_residency')
  }
}

export function normalizeAccount(input: unknown, now = new Date()): AccountCredential {
  const source = record(input)
  const nested = source.tokens && typeof source.tokens === 'object' ? record(source.tokens) : source
  const claims = { ...decodeJwtPayload(text(nested, 'id_token')), ...decodeJwtPayload(text(nested, 'access_token')) }
  const profile = claims['https://api.openai.com/profile']; const auth = claims['https://api.openai.com/auth']
  const profileClaims = profile && typeof profile === 'object' ? record(profile) : {}
  const authData = auth && typeof auth === 'object' ? record(auth) : {}
  const accessToken = text(nested, 'access_token'); const idToken = text(nested, 'id_token'); const refreshToken = text(nested, 'refresh_token')
  if (!accessToken || !idToken || !refreshToken) throw new Error('缺少 access_token、id_token 或 refresh_token')
  const email = text(source, 'email') || text(profileClaims, 'email') || text(claims, 'email')
  const accountId = text(source, 'chatgpt_account_id') || text(nested, 'account_id') || text(authData, 'chatgpt_account_id')
  if (!email || !accountId) throw new Error('无法从账号数据或令牌中识别邮箱和账号 ID')
  for (const key of ['expires_at', 'expired', 'subscription_expires_at', 'createdAt']) {
    const value = text(source, key)
    if (value && !Number.isFinite(Date.parse(value))) throw new Error(`${key} 时间格式无效`)
  }
  const timestamp = now.toISOString()
  return {
    id: createHash('sha256').update(accountId).digest('hex').slice(0, 20) || randomUUID(), email, accountId,
    accessToken, idToken, refreshToken, clientId: text(source, 'client_id') || text(claims, 'client_id'),
    planType: text(source, 'plan_type') || text(authData, 'chatgpt_plan_type') || 'unknown',
    expiresAt: text(source, 'expires_at', 'expired') || (typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : undefined),
    subscriptionExpiresAt: text(source, 'subscription_expires_at'), createdAt: text(source, 'createdAt') || timestamp,
    updatedAt: timestamp, usage: importedUsage(source.extra) || (source.usage as AccountUsage | undefined),
    profile: profileOf(source, claims, authData)
  }
}

export function merge_imported_accounts(existing: AccountCredential[], incoming: AccountCredential[]): AccountCredential[] {
  const imported_ids = new Set(incoming.map(account => account.accountId))
  const merged = new Map<string, AccountCredential>()
  // 仅合并本批导入涉及的账号，避免改动其它历史记录。
  for (const account of existing) {
    const key = imported_ids.has(account.accountId) ? `account:${account.accountId}` : `record:${account.id}`
    if (!merged.has(key)) merged.set(key, account)
  }
  for (const account of incoming) {
    const key = `account:${account.accountId}`
    const previous = merged.get(key)
    merged.set(key, { ...account, id: previous?.id || account.id, createdAt: previous?.createdAt || account.createdAt })
  }
  return [...merged.values()]
}

export function statusOf(account: AccountCredential, activeId?: string): AccountStatus {
  if (account.id === activeId) return 'active'; if (account.lastError) return 'error'; if (!account.expiresAt || !Number.isFinite(Date.parse(account.expiresAt))) return 'unknown'
  return Date.parse(account.expiresAt) <= Date.now() ? 'expired' : 'valid'
}
export const summarize = (account: AccountCredential, activeId?: string): AccountSummary => ({
  id: account.id, email: account.email, planType: account.planType, status: statusOf(account, activeId), expiresAt: account.expiresAt,
  subscriptionExpiresAt: account.subscriptionExpiresAt, isActive: account.id === activeId, createdAt: account.createdAt,
  updatedAt: account.updatedAt, lastError: account.lastError, usage: account.usage, profile: account.profile
})
export const toCodexAuth = (account: AccountCredential): JsonRecord => ({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: account.idToken, access_token: account.accessToken, refresh_token: account.refreshToken, account_id: account.accountId }, last_refresh: account.updatedAt })
export function toImportBundle(accounts: AccountCredential[], exportedAt = new Date().toISOString()): JsonRecord {
  return { exported_at: exportedAt, accounts: accounts.map(account => ({ name: account.email, credentials: { access_token: account.accessToken, id_token: account.idToken, refresh_token: account.refreshToken, account_id: account.accountId, chatgpt_account_id: account.accountId, client_id: account.clientId, email: account.email, plan_type: account.planType, expires_at: account.expiresAt, subscription_expires_at: account.subscriptionExpiresAt, createdAt: account.createdAt } })) }
}

export function parseUsagePayload(input: unknown, fetchedAt = new Date().toISOString()): AccountUsage {
  const source = record(input)
  const rate = source.rate_limit && typeof source.rate_limit === 'object' ? record(source.rate_limit) : source
  const parseWindow = (value: unknown): UsageWindow | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const item = record(value); const usedPercent = number(item, 'used_percent')
    return usedPercent === undefined ? undefined : { usedPercent, windowSeconds: number(item, 'limit_window_seconds', 'window_seconds', 'window_minutes') !== undefined ? (number(item, 'limit_window_seconds', 'window_seconds') ?? number(item, 'window_minutes')! * 60) : undefined, resetAfterSeconds: number(item, 'reset_after_seconds'), resetsAt: number(item, 'reset_at', 'resets_at') }
  }
  const creditsRaw = source.credits && typeof source.credits === 'object' ? record(source.credits) : undefined
  return { primary: parseWindow(rate.primary_window), secondary: parseWindow(rate.secondary_window), credits: creditsRaw ? { hasCredits: creditsRaw.has_credits as boolean | undefined, unlimited: creditsRaw.unlimited as boolean | undefined, balance: creditsRaw.balance as number | string | undefined } : undefined, planType: text(source, 'plan_type'), fetchedAt }
}

export function activeAccountId(authInput: unknown, accounts: AccountCredential[]): string | undefined {
  try {
    const source = record(authInput); const nested = source.tokens && typeof source.tokens === 'object' ? record(source.tokens) : source
    const claims = { ...decodeJwtPayload(text(nested, 'id_token')), ...decodeJwtPayload(text(nested, 'access_token')) }
    const auth = claims['https://api.openai.com/auth']; const authData = auth && typeof auth === 'object' ? record(auth) : {}
    const candidates = new Set([text(nested, 'account_id'), text(source, 'chatgpt_account_id'), text(authData, 'chatgpt_account_id')].filter(Boolean))
    return accounts.find(account => candidates.has(account.accountId))?.id
  } catch { return undefined }
}
