import { randomUUID } from 'node:crypto'
import { merge_imported_accounts, normalizeAccount } from './account'
import type { AccountCredential, AccountImportPreview, AccountImportResult, AccountImportRow } from '../shared/types'
import type { Vault } from './vault'

const as_record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('账号条目必须是 JSON 对象')
  return value as Record<string, unknown>
}

export function prepare_account_import(input: unknown): { accounts: AccountCredential[]; rows: AccountImportRow[] } {
  let items: unknown[]
  if (Array.isArray(input)) items = input
  else {
    const source = as_record(input)
    if ('accounts' in source && !Array.isArray(source.accounts)) throw Error('accounts 必须是账号数组')
    items = Array.isArray(source.accounts) ? source.accounts : [source]
  }
  if (!items.length) throw Error('导入内容中没有账号')
  const accepted = new Map<string, { account: AccountCredential; row: AccountImportRow }>()
  const rows: AccountImportRow[] = []
  for (const [index, item] of items.entries()) {
    const row: AccountImportRow = { index: index + 1, label: `第 ${index + 1} 条`, status: 'skipped' }
    rows.push(row)
    try {
      const entry = as_record(item)
      const label = entry.email || entry.name
      if (typeof label === 'string' && label.trim()) row.label = label.slice(0, 160)
      const platform = typeof entry.platform === 'string' ? entry.platform.trim().toLowerCase() : ''
      const account_type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : ''
      if (platform && !['openai', 'codex'].includes(platform)) throw Error('非 OpenAI/Codex 平台，已跳过')
      if (account_type && !['oauth', 'codex'].includes(account_type)) throw Error('不支持此账号类型，请导入 Codex 登录凭据')
      const source = 'credentials' in entry ? { ...as_record(entry.credentials), extra: entry.extra } : entry
      const account = normalizeAccount(source)
      row.label = account.email; row.account_id = account.accountId; row.status = 'new'
      const previous = accepted.get(account.accountId)
      if (previous) {
        previous.row.status = 'skipped'
        previous.row.reason = `同批账号重复，使用第 ${index + 1} 条有效数据`
      }
      accepted.set(account.accountId, { account, row })
    } catch (error) { row.reason = error instanceof Error ? error.message : '账号格式无效' }
  }
  return { accounts: [...accepted.values()].map(item => item.account), rows }
}

type PendingImport = ReturnType<typeof prepare_account_import> & { preview_id: string; confirming?: boolean }

export class AccountImportService {
  private pending = new Map<number, PendingImport>()
  constructor(private readonly vault: Pick<Vault, 'read' | 'update'>) {}

  cancel(owner: number, preview_id?: string): void {
    if (!preview_id || this.pending.get(owner)?.preview_id === preview_id) this.pending.delete(owner)
  }

  async preview(owner: number, input: unknown): Promise<AccountImportPreview> {
    this.cancel(owner)
    const draft = { ...prepare_account_import(input), preview_id: randomUUID() }
    this.pending.set(owner, draft)
    try {
      const existing = new Set((await this.vault.read()).accounts.map(account => account.accountId))
      if (this.pending.get(owner) !== draft) throw Error('预览已取消，请重新生成')
      const rows = draft.rows.map(row => row.status === 'skipped' ? { ...row } : { ...row, status: existing.has(row.account_id!) ? 'update' as const : 'new' as const })
      return { preview_id: draft.preview_id, rows, added: rows.filter(row => row.status === 'new').length, updated: rows.filter(row => row.status === 'update').length, skipped: rows.filter(row => row.status === 'skipped').length }
    } catch (error) { this.cancel(owner, draft.preview_id); throw error }
  }

  async confirm(owner: number, preview_id: string): Promise<AccountImportResult> {
    const draft = this.pending.get(owner)
    if (!draft || draft.preview_id !== preview_id) throw Error('导入预览已失效，请重新预览')
    if (draft.confirming) throw Error('该预览正在导入，请勿重复确认')
    if (!draft.accounts.length) throw Error('没有可导入的账号，请返回修改数据')
    // 解析后的凭据只留在主进程；锁定当前预览，防止重复确认造成二次写入。
    draft.confirming = true
    try {
      const result = await this.vault.update(data => {
        const existing = new Set(data.accounts.map(account => account.accountId))
        const added = draft.accounts.filter(account => !existing.has(account.accountId)).length
        data.accounts = merge_imported_accounts(data.accounts, draft.accounts.map(account => ({ ...account, updatedAt: new Date().toISOString() })))
        return { added, updated: draft.accounts.length - added, skipped: draft.rows.filter(row => row.status === 'skipped').length }
      })
      this.cancel(owner, draft.preview_id)
      return result
    } finally { draft.confirming = false }
  }
}
