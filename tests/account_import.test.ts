import { describe, expect, it } from 'vitest'
import { accountItems, merge_imported_accounts, normalizeAccount } from '../src/main/account'

const fixture = (account_id = 'account-one', access_token = '测试凭据') => ({
  type: 'codex', email: 'sample@example.com', account_id,
  access_token, id_token: '测试身份令牌', refresh_token: '测试刷新令牌',
  expired: '2030-12-31T23:59:59Z', last_refresh: '2026-09-22T00:00:00Z'
})

describe('账号导入兼容与去重', () => {
  it('读取 Codex2API 官方 JSON 数组及 expired 字段', () => {
    const [item] = accountItems([fixture()])
    expect(normalizeAccount(item)).toMatchObject({ accountId: 'account-one', expiresAt: fixture().expired })
  })
  it('拒绝无效的 Codex2API 到期时间', () => {
    expect(() => normalizeAccount({ ...fixture(), expired: '无效时间' })).toThrow('时间格式无效')
  })
  it('同一账号更新凭据，保留记录标识与首次添加时间，清除旧错误', () => {
    const previous = { ...normalizeAccount(fixture(), new Date('2025-01-01')), id: '历史标识', lastError: '旧错误' }
    const incoming = normalizeAccount(fixture('account-one', '新凭据'), new Date('2026-09-22'))
    const result = merge_imported_accounts([previous], [incoming])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: previous.id, createdAt: previous.createdAt, accessToken: '新凭据', updatedAt: incoming.updatedAt })
    expect(result[0].lastError).toBeUndefined()
    expect(previous.accessToken).toBe('测试凭据')
  })
  it('批次内同账号以最后一条为准，并合并已有重复记录', () => {
    const previous = normalizeAccount(fixture())
    const result = merge_imported_accounts([previous, { ...previous, id: '重复标识' }], [normalizeAccount(fixture('account-one', '第一条')), normalizeAccount(fixture('account-one', '最后一条'))])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(previous.id)
    expect(result[0].accessToken).toBe('最后一条')
  })
  it('同邮箱的不同账号 ID 不合并，未导入的账号保持原样', () => {
    const previous = normalizeAccount(fixture())
    const incoming = normalizeAccount(fixture('account-two'))
    expect(merge_imported_accounts([previous], [incoming])).toEqual([previous, incoming])
  })
})
