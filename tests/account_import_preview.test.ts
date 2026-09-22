import { describe, expect, it } from 'vitest'
import { AccountImportService, prepare_account_import } from '../src/main/account_import'
import { normalizeAccount } from '../src/main/account'
import type { VaultData } from '../src/main/vault'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const fixture = (account_id = 'one', access_token = '合成访问凭据') => ({ email: 'test@example.com', account_id, access_token, id_token: '合成身份凭据', refresh_token: '合成刷新凭据' })
function setup() {
  let data: VaultData = { accounts: [normalizeAccount(fixture())], settings: { ...DEFAULT_SETTINGS } }
  let writes = 0
  const vault = { read: async () => structuredClone(data), update: async <T>(work: (value: VaultData) => T | Promise<T>): Promise<T> => { const next = structuredClone(data); const result = await work(next); data = next; writes++; return result } }
  return { service: new AccountImportService(vault), vault, data: () => data, writes: () => writes }
}

describe('账号导入预览与部分导入', () => {
  it('逐条处理混合 Sub2API 账号，其它平台、API Key 和坏条目不阻断有效账号', () => {
    const result = prepare_account_import({ accounts: [
      { platform: 'openai', type: 'oauth', credentials: fixture() },
      { platform: 'anthropic', type: 'oauth', credentials: fixture('other') },
      { platform: 'openai', type: 'apikey', credentials: fixture('key') },
      null, { platform: 'openai', credentials: { email: 'bad@example.com' } },
      { platform: 'openai', type: 'oauth', credentials: fixture('two') }
    ] })
    expect(result.accounts.map(account => account.accountId)).toEqual(['one', 'two'])
    expect(result.rows.map(row => row.status)).toEqual(['new', 'skipped', 'skipped', 'skipped', 'skipped', 'new'])
    expect(result.rows[1].reason).toContain('平台')
    expect(result.rows[2].reason).toContain('类型')
    expect(result.rows[4].reason).toContain('缺少')
    expect(JSON.stringify(result.rows)).not.toContain('合成访问凭据')
  })
  it('按最后一条有效数据去重，坏的后续条目不会抹掉前面的有效条目', () => {
    const result = prepare_account_import([fixture(), fixture('one', '最后有效凭据'), { ...fixture(), refresh_token: '' }])
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].accessToken).toBe('最后有效凭据')
    expect(result.rows[0].reason).toContain('第 2 条')
    expect(result.rows.map(row => row.status)).toEqual(['skipped', 'new', 'skipped'])
  })
  it('兼容 Codex2API、auth.json，以及单个带 credentials 的对象', () => {
    for (const input of [[{ type: 'codex', ...fixture(), expired: '2030-01-01' }], { email: 'test@example.com', tokens: fixture() }, { platform: 'openai', type: 'oauth', credentials: fixture() }]) {
      expect(prepare_account_import(input).accounts).toHaveLength(1)
    }
  })
  it('空数组或无效容器报错，不对单条校验结果报整批异常', () => {
    expect(() => prepare_account_import([])).toThrow('没有账号')
    expect(() => prepare_account_import({ accounts: 'invalid' })).toThrow('数组')
    expect(prepare_account_import([null, 2, 'bad']).accounts).toHaveLength(0)
  })
  it('预览返回新增/更新/跳过清单，不写库、不返回凭据，确认只写一次有效数据', async () => {
    const test = setup()
    const preview = await test.service.preview(1, [fixture('one', '新凭据'), fixture('two'), {}])
    expect(preview).toMatchObject({ added: 1, updated: 1, skipped: 1 })
    expect(test.writes()).toBe(0)
    expect(JSON.stringify(preview)).not.toContain('新凭据')
    expect(preview.rows.map(row => row.status)).toEqual(['update', 'new', 'skipped'])
    const result = await test.service.confirm(1, preview.preview_id)
    expect(result).toEqual({ added: 1, updated: 1, skipped: 1 })
    expect(test.data().accounts).toHaveLength(2)
    expect(test.data().accounts[0].accessToken).toBe('新凭据')
    expect(test.writes()).toBe(1)
    await expect(test.service.confirm(1, preview.preview_id)).rejects.toThrow('预览')
  })
  it('取消、其它窗口及被替换的预览均不能确认', async () => {
    const test = setup()
    const old = await test.service.preview(1, [fixture('two')])
    await expect(test.service.confirm(2, old.preview_id)).rejects.toThrow('预览')
    const next = await test.service.preview(1, [fixture('three')])
    test.service.cancel(1, old.preview_id)
    await expect(test.service.confirm(1, old.preview_id)).rejects.toThrow('预览')
    test.service.cancel(1, next.preview_id)
    await expect(test.service.confirm(1, next.preview_id)).rejects.toThrow('预览')
    expect(test.writes()).toBe(0)
  })
  it('全部失败时不能确认，预览也不修改原账号', async () => {
    const test = setup()
    const preview = await test.service.preview(1, [{ email: 'bad@example.com' }])
    expect(preview).toMatchObject({ added: 0, updated: 0, skipped: 1 })
    await expect(test.service.confirm(1, preview.preview_id)).rejects.toThrow('没有可导入')
    expect(test.writes()).toBe(0)
  })
  it('确认时按最新账号库重新统计，仍保留已有记录 ID 和创建时间', async () => {
    const test = setup()
    const preview = await test.service.preview(1, [fixture('two', '新凭据')])
    await test.vault.update(data => { data.accounts.push(normalizeAccount(fixture('two'), new Date('2020-01-01'))) })
    const previous = test.data().accounts[1]
    expect(await test.service.confirm(1, preview.preview_id)).toEqual({ added: 0, updated: 1, skipped: 0 })
    expect(test.data().accounts[1]).toMatchObject({ id: previous.id, createdAt: previous.createdAt, accessToken: '新凭据' })
  })
  it('写入失败可以重试，但取消或关闭窗口后不能重新出现旧预览', async () => {
    const test = setup()
    let fail_write = true
    const retry_service = new AccountImportService({ ...test.vault, update: async work => {
      if (fail_write) throw Error('合成写入失败')
      return test.vault.update(work)
    } })
    const preview = await retry_service.preview(1, [fixture('two')])
    await expect(retry_service.confirm(1, preview.preview_id)).rejects.toThrow('合成写入失败')
    fail_write = false
    expect(await retry_service.confirm(1, preview.preview_id)).toMatchObject({ added: 1 })

    let reject_write!: (error: Error) => void
    let attempts = 0
    const service = new AccountImportService({ ...test.vault, update: async () => {
      if (++attempts > 1) throw Error('不应再次写入')
      return await new Promise<never>((_resolve, reject) => { reject_write = reject })
    } })
    const pending = await service.preview(1, [fixture('three')])
    const saving = service.confirm(1, pending.preview_id)
    service.cancel(1)
    reject_write(Error('合成写入失败'))
    await expect(saving).rejects.toThrow('合成写入失败')
    await expect(service.confirm(1, pending.preview_id)).rejects.toThrow('预览')
    expect(attempts).toBe(1)
  })
})
