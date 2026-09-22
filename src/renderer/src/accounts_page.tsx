import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Grid2X2, List, Plus, RefreshCw, UserRoundCheck } from 'lucide-react'
import type { AccountImportPreview, AccountImportRow, AccountSummary, AppSettings, OperationResult, UsageWindow } from '../../shared/types'
import { sortAccounts } from '../../shared/accountSort'
import { ActionMenu, Button, Dialog, EmptyState, error_text, Notice, PageHeader, SearchField, StatusBadge, use_confirm, use_leave_guard } from './ui'
import type { NoticeValue, RegisterGuard } from './ui'

const account_json_example = JSON.stringify({
  email: 'you@example.com',
  account_id: '替换为账号 ID',
  access_token: '替换为 access_token',
  id_token: '替换为 id_token',
  refresh_token: '替换为 refresh_token'
}, null, 2)

export function display_date(value?: string): string {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '未知'
}
function reset_text(window?: UsageWindow): string {
  if (!window) return '尚未查询'
  const seconds = window.resetAfterSeconds ?? (window.resetsAt ? window.resetsAt - Date.now() / 1000 : undefined)
  if (seconds === undefined) return '重置时间未知'
  if (seconds <= 0) return '即将重置'
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600)
  return `${days ? `${days}天 ` : ''}${hours ? `${hours}小时 ` : ''}${Math.floor(seconds % 3600 / 60)}分后重置`
}
function quota_label(window?: UsageWindow): string {
  if (!window?.windowSeconds) return '额度'
  return window.windowSeconds <= 21600 ? '5 小时' : window.windowSeconds >= 500000 ? '7 天' : `${Math.round(window.windowSeconds / 3600)} 小时`
}
function UsageBars({ account }: { account: AccountSummary }): React.JSX.Element {
  return <div className="usage">{[account.usage?.secondary, account.usage?.primary].map((window, index) => <div className="quota" key={index}>
    <div className="quota-caption"><span>{quota_label(window)}</span><b>{window ? `${Math.round(window.usedPercent)}% 已用` : '待查询'}</b><small>{reset_text(window)}</small></div>
    <div className={`quota-track ${window && window.usedPercent >= 90 ? 'quota-warning' : ''}`} role={window ? 'progressbar' : undefined} aria-label={`${quota_label(window)}已用比例`} aria-valuenow={window ? Math.max(0, Math.min(100, window.usedPercent)) : undefined} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(0, Math.min(100, window?.usedPercent || 0))}%` }} /></div>
  </div>)}</div>
}

export function AccountsPage({ settings, save_preference, register_guard }: { settings: AppSettings; save_preference: (patch: Partial<AppSettings>) => Promise<void>; register_guard: RegisterGuard }): React.JSX.Element {
  const [accounts, set_accounts] = useState<AccountSummary[]>([])
  const [loading, set_loading] = useState(true)
  const [load_failed, set_load_failed] = useState(false)
  const [query, set_query] = useState('')
  const [selected, set_selected] = useState<Set<string>>(new Set())
  const [busy, set_busy] = useState<string | null>(null)
  const [notice, set_notice] = useState<NoticeValue | null>(null)
  const [add_open, set_add_open] = useState(false)
  const [raw_json, set_raw_json] = useState('')
  const [import_error, set_import_error] = useState('')
  const [import_preview, set_import_preview] = useState<AccountImportPreview | null>(null)
  const [import_filter, set_import_filter] = useState<'all' | AccountImportRow['status']>('all')
  const preview_id = useRef<string | null>(null)
  const preview_heading = useRef<HTMLHeadingElement | null>(null)
  const running = useRef(false)
  const confirm = use_confirm()
  const load = useCallback(async () => {
    try {
      const response = await window.codexAccounts.list()
      if (!response.success) throw new Error(response.error || '账号读取失败')
      const next = response.data || []
      set_accounts(next); set_load_failed(false)
      set_selected(current => new Set([...current].filter(id => next.some(account => account.id === id))))
    } catch (error) { set_notice({ text: error_text(error), error: true }); set_load_failed(true) }
    finally { set_loading(false) }
  }, [])
  useEffect(() => { void load(); return window.codexAccounts.onChanged(() => void load()) }, [load])
  useEffect(() => () => { if (preview_id.current) void window.codexAccounts.cancelImport(preview_id.current).catch(() => {}) }, [])
  useEffect(() => { if (import_preview) preview_heading.current?.focus() }, [import_preview])
  use_leave_guard(register_guard, async () => !running.current && (!raw_json.trim() && !import_preview || await confirm({ title: '放弃未导入的账号？', description: '输入内容尚未导入，离开后不会保留。', action: '放弃输入' })))
  const visible = useMemo(() => sortAccounts(accounts.filter(account => `${account.email} ${account.planType} ${account.profile?.organizationTitle || ''}`.toLowerCase().includes(query.toLowerCase())), settings.accountSort), [accounts, query, settings.accountSort])
  const all_selected = visible.length > 0 && visible.every(account => selected.has(account.id))
  const select_visible = () => set_selected(current => { const next = new Set(current); visible.forEach(account => all_selected ? next.delete(account.id) : next.add(account.id)); return next })
  const run = async (key: string, work: () => Promise<OperationResult<unknown>>, message: string | ((data: unknown) => string), allow_zero = false): Promise<boolean> => {
    if (running.current) return false
    running.current = true; set_busy(key); set_notice(null)
    try {
      const result = await work()
      if (!result.success) throw new Error(result.error || '操作失败')
      if (result.data === 0 && !allow_zero) return false
      set_notice({ text: typeof message === 'function' ? message(result.data) : message })
      return true
    } catch (error) { const text = error_text(error); set_notice({ text, error: true }); if (key === 'paste') set_import_error(text); return false }
    finally { await load(); running.current = false; set_busy(null) }
  }
  const close_add = async () => {
    if (running.current) return
    if (!import_preview && raw_json.trim() && !await confirm({ title: '放弃未导入的账号？', description: '输入内容尚未导入，关闭后不会保留。', action: '放弃输入' })) return
    await discard_preview()
    set_add_open(false); set_raw_json(''); set_import_error('')
  }
  const discard_preview = async () => {
    if (preview_id.current) await window.codexAccounts.cancelImport(preview_id.current)
    preview_id.current = null; set_import_preview(null); set_import_error('')
  }
  const prepare_import = async (source: 'paste' | 'file' | 'local') => {
    if (running.current) return
    running.current = true; set_busy(source); set_import_error(''); set_notice(null)
    try {
      const result = await (source === 'paste' ? window.codexAccounts.importText(raw_json) : source === 'file' ? window.codexAccounts.importFile() : window.codexAccounts.importLocal())
      if (!result.success) throw Error(result.error || '导入预览失败')
      if (!result.data) return
      preview_id.current = result.data.preview_id
      set_import_preview(result.data); set_import_filter('all'); set_add_open(true)
      if (source !== 'paste') set_raw_json('')
    } catch (error) { set_import_error(error_text(error)); set_add_open(true) }
    finally { running.current = false; set_busy(null) }
  }
  const commit_import = async () => {
    if (!import_preview || running.current) return
    running.current = true; set_busy('import-confirm'); set_import_error('')
    try {
      const response = await window.codexAccounts.confirmImport(import_preview.preview_id)
      if (!response.success || !response.data) throw Error(response.error || '账号导入失败')
      const result = response.data
      preview_id.current = null; set_import_preview(null); set_add_open(false); set_raw_json('')
      set_notice({ text: `导入完成：新增 ${result.added} 个，更新 ${result.updated} 个，跳过 ${result.skipped} 条` })
      await load()
    } catch (error) { set_import_error(error_text(error)) }
    finally { running.current = false; set_busy(null) }
  }
  const remove = async (ids: string[]) => {
    if (!await confirm({ title: ids.length > 1 ? `移除 ${ids.length} 个账号？` : '移除这个账号？', description: '仅从管理器移除，不会删除 Codex 当前登录文件。请确认已妥善保存需要的凭据。', action: '移除账号', danger: true })) return
    await run('remove', () => ids.length === 1 ? window.codexAccounts.remove(ids[0]) : window.codexAccounts.removeMany(ids), '账号已移除')
  }
  return <section className="accounts-page" aria-busy={loading || !!busy}>
    <PageHeader title="账号管理" description="让每个账号的状态与用量，一目了然。" actions={<><Button disabled={!!busy} onClick={() => void run('all', () => window.codexAccounts.refreshAll(), data => `查询完成，${data} 个账号更新成功；失败详情见账号卡片`, true)}><RefreshCw size={16} className={busy === 'all' ? 'spin' : ''} />刷新全部</Button><Button variant="primary" disabled={!!busy} onClick={() => set_add_open(true)}><Plus size={17} />添加账号</Button></>} />
    <div className="account-overview"><span><b>{accounts.length}</b> 个账号</span><span className="overview-divider" /><span><i className="dot success" />{accounts.filter(account => ['active', 'valid'].includes(account.status)).length} 个可用</span><span className="overview-divider" /><span>{accounts.some(account => account.isActive) ? '已识别本机登录' : '尚未匹配本机登录'}</span></div>
    <div className="toolbar"><SearchField label="搜索账号" value={query} on_change={set_query} placeholder="搜索邮箱、套餐或组织" /><div className="toolbar-actions"><label className="select-field"><span className="sr-only">账号排序</span><select aria-label="账号排序" value={settings.accountSort} disabled={!!busy} onChange={event => void save_preference({ accountSort: event.target.value as AppSettings['accountSort'] })}><option value="remaining">剩余用量优先</option><option value="createdAt">最近添加</option><option value="subscriptionExpiresAt">订阅到期较晚</option></select></label><div className="segmented" aria-label="账号布局"><button aria-label="卡片布局" aria-pressed={settings.viewMode === 'cards'} onClick={() => void save_preference({ viewMode: 'cards' })}><Grid2X2 size={16} /></button><button aria-label="列表布局" aria-pressed={settings.viewMode === 'list'} onClick={() => void save_preference({ viewMode: 'list' })}><List size={16} /></button></div><ActionMenu label="账号操作" disabled={!!busy} items={[{ label: '导入 JSON 文件', action: () => void prepare_import('file') }, { label: '导入本机登录', action: () => void prepare_import('local') }]} /></div></div>
    {!loading && accounts.length > 0 && <div className="selection-bar"><label className="check-label"><input type="checkbox" aria-label="全选可见账号" checked={all_selected} onChange={select_visible} disabled={!visible.length || !!busy} />{selected.size ? `已选择 ${selected.size} 个` : '全选'}</label>{selected.size > 0 && <div className="selection-actions"><Button disabled={!!busy} onClick={() => void run('export', () => window.codexAccounts.export([...selected]), '所选账号已导出')}><Download size={14} />导出</Button><Button variant="ghost" className="danger-text" disabled={!!busy} onClick={() => void remove([...selected])}>移除</Button><Button variant="ghost" onClick={() => set_selected(new Set())}>取消选择</Button></div>}<span className="selection-count">{query ? `${visible.length} 个匹配结果` : '仅在查询后更新用量'}</span></div>}
    {loading ? <EmptyState loading title="正在读取账号" /> : load_failed ? <EmptyState title="账号暂时无法读取" description="请检查本地凭据库后重试。" action={<Button onClick={() => void load()}>重新加载</Button>} /> : !visible.length ? <EmptyState title={query ? '没有找到匹配账号' : '添加你的第一个账号'} description={query ? '试试其他邮箱、套餐或组织名称。' : '导入已有登录，集中查看账号状态与额度。'} action={<Button onClick={() => query ? set_query('') : set_add_open(true)}>{query ? '清除搜索' : '添加账号'}</Button>} /> : <div className={`accounts ${settings.viewMode}`}>{visible.map(account => {
      const current = account.isActive
      const status = current ? '当前登录' : ({ valid: '可用', expired: '已过期', error: '异常', unknown: '待验证', active: '当前登录' })[account.status]
      const plan = account.usage?.planType || account.planType
      const provider = ({ google: 'Google', microsoft: 'Microsoft', apple: 'Apple', password: '邮箱密码' })[account.profile?.authProvider || ''] || account.profile?.authProvider || '未知'
      return <article key={account.id} className={`account ${current ? 'is-current' : ''} ${selected.has(account.id) ? 'is-selected' : ''}`}>
        <div className="account-head"><input type="checkbox" checked={selected.has(account.id)} disabled={!!busy} aria-label={`选择 ${account.email}`} onChange={() => set_selected(previous => { const next = new Set(previous); next.has(account.id) ? next.delete(account.id) : next.add(account.id); return next })} /><div className="avatar" aria-hidden="true">{account.email[0].toUpperCase()}</div><div className="identity"><h2 className="truncate-reveal" tabIndex={0} title={account.email} data-full-text={account.email}>{account.email}</h2><span>更新于 {display_date(account.updatedAt)}</span></div><ActionMenu icon_only label={`${account.email} 更多操作`} disabled={!!busy} items={[{ label: '移除账号', danger: true, action: () => void remove([account.id]) }]} /></div>
        <div className="account-meta"><span className="plan-chip" title="账号等级">{plan === 'free' ? '免费版' : plan === 'unknown' ? '未知套餐' : plan.toUpperCase()}</span><span className="account-organization" title={`账号归属：${account.profile?.organizationTitle || 'Personal'}`}>{account.profile?.organizationTitle || 'Personal'}</span><StatusBadge tone={current || account.status === 'valid' ? 'success' : account.status === 'error' || account.status === 'expired' ? 'danger' : 'neutral'}>{status}</StatusBadge></div>
        <UsageBars account={account} />
        <div className="account-facts"><span title="登录方式">{provider} 登录</span><span title="订阅有效期">订阅：{display_date(account.subscriptionExpiresAt)}</span></div>
        {account.lastError && <p className="account-error"><span>查询异常</span>{account.lastError}</p>}
        <div className="card-actions"><Button disabled={!!busy} onClick={() => void run(`query-${account.id}`, () => window.codexAccounts.refresh(account.id), '用量已更新')}><RefreshCw size={14} className={busy === `query-${account.id}` ? 'spin' : ''} />查询</Button><Button variant={current ? 'ghost' : 'secondary'} disabled={current || !!busy} onClick={() => void run(`switch-${account.id}`, () => window.codexAccounts.activate(account.id), '已切换本机登录')}><UserRoundCheck size={14} />{current ? '正在使用' : '切换'}</Button></div>
      </article>
    })}</div>}
    <Notice value={notice} clear={() => set_notice(null)} />
    {add_open && <Dialog title={import_preview ? '导入预览' : '添加账号'} description={import_preview ? '检查新增、更新与跳过清单，确认后只导入有效账号。' : '从文件导入，或粘贴已有账号的登录凭据。'} close={() => void close_add()} busy={!!busy} className={import_preview ? 'account-import-preview' : ''} actions={<>
      <Button disabled={!!busy} onClick={() => void close_add()}>取消</Button>
      {import_preview ? <><Button disabled={!!busy} onClick={() => void discard_preview()}>返回修改</Button><Button variant="primary" disabled={!!busy || import_preview.added + import_preview.updated === 0} onClick={() => void commit_import()}>{busy === 'import-confirm' ? '正在导入…' : `确认导入 ${import_preview.added + import_preview.updated} 个账号`}</Button></> : <Button variant="primary" disabled={!!busy || !raw_json.trim()} onClick={() => void prepare_import('paste')}>{busy === 'paste' ? '正在校验…' : '预览导入'}</Button>}
    </>}>
      {import_preview ? <>
        <div className="import-preview-summary"><h3 ref={preview_heading} tabIndex={-1}>{import_preview.added + import_preview.updated ? `可导入 ${import_preview.added + import_preview.updated} 个账号` : '没有可导入的账号'}</h3><p>新增 {import_preview.added} 个 · 更新 {import_preview.updated} 个 · 跳过 {import_preview.skipped} 条</p><p className="field-hint">同账号使用最后一条有效数据；其它平台或校验失败的条目不会写入。</p></div>
        <div className="import-preview-filters" role="group" aria-label="筛选导入结果">{(['all', 'new', 'update', 'skipped'] as const).map(filter => <Button key={filter} variant={filter === import_filter ? 'primary' : 'secondary'} aria-pressed={filter === import_filter} onClick={() => set_import_filter(filter)}>{{ all: '全部', new: '新增', update: '更新', skipped: '跳过' }[filter]} {filter === 'all' ? import_preview.rows.length : filter === 'new' ? import_preview.added : filter === 'update' ? import_preview.updated : import_preview.skipped}</Button>)}</div>
        <ol className="import-preview-list" aria-label="账号导入清单">{import_preview.rows.filter(row => import_filter === 'all' || row.status === import_filter).map(row => <li key={row.index} className="import-preview-row"><span className="import-row-index">{row.index}</span><div className="import-row-details"><b>{row.label}</b>{row.account_id && <p className="import-account-id">账号 ID：{row.account_id}</p>}{row.reason && <p className="import-row-reason">{row.reason}</p>}</div><StatusBadge tone={row.status === 'skipped' ? 'warning' : row.status === 'update' ? 'neutral' : 'success'}>{{ new: '新增', update: '更新', skipped: '跳过' }[row.status]}</StatusBadge></li>)}</ol>
        {!import_preview.rows.some(row => import_filter === 'all' || row.status === import_filter) && <p className="field-hint">没有此类条目。</p>}
      </> : <>
        <div className="account-import-formats"><strong>支持 Sub2API、Codex2API 的 JSON 导出</strong><p>也支持 Codex auth.json 和账号数组。先预览再导入；相同账号自动更新，其它平台及无效条目可跳过。</p></div>
        <div className="import-options"><Button disabled={!!busy} onClick={() => void prepare_import('file')}>选择 JSON 文件</Button><Button disabled={!!busy} onClick={() => void prepare_import('local')}>导入本机登录</Button></div>
        <label className="field-label" htmlFor="account-json">或粘贴账号 JSON</label><textarea id="account-json" className="code-editor" value={raw_json} onChange={event => { set_raw_json(event.target.value); set_import_error('') }} placeholder={account_json_example} spellCheck={false} aria-invalid={!!import_error} aria-describedby={import_error ? 'import-hint import-error' : 'import-hint'} disabled={!!busy} />
        <p className="field-hint" id="import-hint">示例字段请替换为实际凭据；多个账号可使用 JSON 数组。请仅导入你有权管理的账号。</p>
      </>}
      {import_error && <p className="field-error" id="import-error" role="alert">{import_error}</p>}
    </Dialog>}
  </section>
}
