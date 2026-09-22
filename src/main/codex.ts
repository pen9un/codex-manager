import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { AccountCredential, AppSettings } from '../shared/types'
import { normalizeAccount, parseUsagePayload, toCodexAuth } from './account'

export const codexHome = (): string => process.env.CODEX_HOME || join(homedir(), '.codex')
export const authPath = (): string => join(codexHome(), 'auth.json')
export const configPath = (): string => join(codexHome(), 'config.toml')
export const loadLocalAuth = async (): Promise<AccountCredential> => normalizeAccount(JSON.parse(await readFile(authPath(), 'utf8')))

export async function activate(account: AccountCredential): Promise<void> {
  const target = authPath(); await mkdir(dirname(target), { recursive: true })
  try { await copyFile(target, `${target}.bak`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = `${target}.tmp`; await writeFile(temporary, `${JSON.stringify(toCodexAuth(account), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, target)
}

function request(url: string, init: Parameters<typeof undiciFetch>[1], settings: AppSettings) {
  const dispatcher = settings.proxyEnabled && settings.proxyUrl ? new ProxyAgent(settings.proxyUrl) : undefined
  return undiciFetch(url, { ...init, dispatcher, signal: AbortSignal.timeout(25_000) })
}

export async function fetchUsage(account: AccountCredential, settings: AppSettings): Promise<AccountCredential> {
  const response = await request('https://chatgpt.com/backend-api/wham/usage', { headers: { authorization: `Bearer ${account.accessToken}`, 'chatgpt-account-id': account.accountId, 'openai-beta': 'codex-1', 'oai-language': 'zh-CN', originator: 'Codex Desktop', accept: 'application/json', 'user-agent': 'codex-cli/0.91.0' } }, settings)
  if (response.status === 401) throw new Error('登录凭据已过期，请从原客户端重新登录并导入最新凭据（HTTP 401）')
  if (!response.ok) throw new Error(`用量查询失败（HTTP ${response.status}）`)
  return { ...account, usage: parseUsagePayload(await response.json()), updatedAt: new Date().toISOString(), lastError: undefined }
}

export function mergeLocalCredential(account: AccountCredential, local: AccountCredential): AccountCredential {
  if (account.accountId !== local.accountId) return account
  return { ...account, ...local, id: account.id, createdAt: account.createdAt, subscriptionExpiresAt: account.subscriptionExpiresAt, usage: account.usage, lastError: undefined }
}

export const refreshAccount = fetchUsage
