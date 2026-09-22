import { BrandMark } from './brand_mark'
import { APP_NAME, APP_TAGLINE } from '../../shared/branding'
import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import type { AppInfo, AppSettings, ThemeMode } from '../../shared/types'
import { Button, error_text, Notice, PageHeader, use_confirm, use_leave_guard } from './ui'
import type { NoticeValue, RegisterGuard } from './ui'

function SettingSwitch({ label, description, checked, change, disabled }: { label: string; description: string; checked: boolean; change: (value: boolean) => void; disabled?: boolean }): React.JSX.Element {
  return <div className="setting-row"><div><b>{label}</b><p>{description}</p></div><button type="button" role="switch" aria-label={label} aria-checked={checked} className="switch" disabled={disabled} onClick={() => change(!checked)}><span /></button></div>
}

export function SettingsPage({ settings, commit, preview_theme, register_guard }: { settings: AppSettings; commit: (next: AppSettings) => Promise<void>; preview_theme: (mode: ThemeMode | null) => void; register_guard: RegisterGuard }): React.JSX.Element {
  const [draft, set_draft] = useState(settings)
  const [busy, set_busy] = useState(false)
  const [notice, set_notice] = useState<NoticeValue | null>(null)
  const [save_failed, set_save_failed] = useState(false)
  const [retry, set_retry] = useState(0)
  const draft_ref = useRef(draft)
  const saved_ref = useRef(settings)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const running = useRef<Promise<boolean> | null>(null)
  const mounted = useRef(true)
  draft_ref.current = draft
  const confirm = use_confirm()
  // 导航偏好来自全局即时保存，不被设置页的旧草稿覆盖。
  useEffect(() => {
    const preferences = { sidebarCollapsed: settings.sidebarCollapsed, viewMode: settings.viewMode, accountSort: settings.accountSort }
    saved_ref.current = { ...saved_ref.current, ...preferences }
    set_draft(current => Object.entries(preferences).every(([key, value]) => current[key as keyof AppSettings] === value) ? current : { ...current, ...preferences })
  }, [settings.sidebarCollapsed, settings.viewMode, settings.accountSort])
  useEffect(() => { preview_theme(draft.themeMode); return () => preview_theme(null) }, [draft.themeMode, preview_theme])
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  let proxy_error = ''
  if (draft.proxyEnabled) { try { if (!['http:', 'https:'].includes(new URL(draft.proxyUrl).protocol)) throw new Error() } catch { proxy_error = '请输入有效的 HTTP 或 HTTPS 代理地址' } }
  const interval_error = draft.autoRefresh && (!Number.isInteger(draft.refreshMinutes) || draft.refreshMinutes < 1) ? '请输入至少 1 分钟的整数' : ''
  const valid = (value: AppSettings) => {
    if (value.autoRefresh && (!Number.isInteger(value.refreshMinutes) || value.refreshMinutes < 1)) return false
    if (value.proxyEnabled) { try { if (!['http:', 'https:'].includes(new URL(value.proxyUrl).protocol)) return false } catch { return false } }
    return true
  }
  const save = (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (running.current) return running.current
    const operation = (async () => {
      set_busy(true); set_save_failed(false); set_notice(null)
      try {
        // 串行合并快速改动；保存期间保持输入可用，下一轮提交最新草稿。
        while (JSON.stringify(draft_ref.current) !== JSON.stringify(saved_ref.current)) {
          const next = { ...draft_ref.current }
          if (!valid(next)) return false
          if (!Number.isInteger(next.refreshMinutes) || next.refreshMinutes < 1) {
            next.refreshMinutes = saved_ref.current.refreshMinutes
            draft_ref.current = next; set_draft(next)
          }
          await commit(next)
          saved_ref.current = next
        }
        return true
      } catch (error) {
        if (mounted.current) { set_save_failed(true); set_notice({ text: error_text(error), error: true }) }
        return false
      } finally { if (mounted.current) set_busy(false) }
    })()
    running.current = operation
    void operation.finally(() => { running.current = null })
    return operation
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current) }
  }, [])
  useEffect(() => {
    if (!dirty || proxy_error || interval_error) return
    timer.current = setTimeout(() => { void save() }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [draft, retry])
  use_leave_guard(register_guard, async () => {
    if (await save()) return true
    return confirm({ title: '仍有设置未能自动保存', description: '请先修正无效输入或重试保存。离开会丢弃未保存的改动。', action: '放弃未保存改动' })
  })
  const theme_options = [{ value: 'light', name: '浅色', icon: Sun }, { value: 'dark', name: '深色', icon: Moon }, { value: 'system', name: '跟随系统', icon: Monitor }, { value: 'high-contrast', name: '高对比', icon: Check }] as const
  return <section className="settings-page" aria-busy={busy}><PageHeader title="应用设置" description="按照你的习惯，调整这个工作空间。" />
    <div className="settings-content"><section className="settings-section"><header><h2>外观</h2><p>选择舒适的明暗模式，更改会自动保存。</p></header><div className="appearance-options" role="group" aria-label="界面主题">{theme_options.map(option => <button type="button" key={option.value} aria-pressed={draft.themeMode === option.value}  onClick={() => set_draft({ ...draft, themeMode: option.value })}><span className={`appearance-sample sample-${option.value}`}><i /><b /><em /></span><span><option.icon size={15} />{option.name}{draft.themeMode === option.value && <Check size={14} />}</span></button>)}</div></section>
      <section className="settings-section"><header><h2>用量更新</h2><p>定期查询额度，不刷新或轮换登录令牌。</p></header><SettingSwitch label="自动更新用量" description="在后台定时查询已导入账号的额度。" checked={draft.autoRefresh} change={value => set_draft({ ...draft, autoRefresh: value })}  /><div className="setting-row"><label htmlFor="refresh-minutes"><b>查询间隔</b><p>{draft.autoRefresh ? '至少 1 分钟。' : '启用自动更新后可调整。'}</p></label><div className="setting-input"><div className="input-unit"><input id="refresh-minutes" type="number" min={1} step={1} value={Number.isNaN(draft.refreshMinutes) ? '' : draft.refreshMinutes} disabled={!draft.autoRefresh} onChange={event => set_draft({ ...draft, refreshMinutes: event.target.value === '' ? NaN : Number(event.target.value) })} aria-invalid={!!interval_error} aria-describedby="interval-error" /><span>分钟</span></div>{interval_error && <p className="field-error" id="interval-error" role="alert">{interval_error}</p>}</div></div></section>
      <section className="settings-section"><header><h2>网络代理</h2><p>只作用于管理器的用量查询。</p></header><SettingSwitch label="启用代理" description="通过指定的 HTTP / HTTPS 代理连接。" checked={draft.proxyEnabled} change={value => set_draft({ ...draft, proxyEnabled: value })}  /><div className="setting-row"><label htmlFor="proxy-url"><b>代理地址</b><p>{draft.proxyEnabled ? '包含协议、主机及端口。' : '启用代理后可编辑。'}</p></label><div className="setting-input"><input id="proxy-url" placeholder="http://127.0.0.1:7070" value={draft.proxyUrl} disabled={!draft.proxyEnabled} onChange={event => set_draft({ ...draft, proxyUrl: event.target.value })} aria-invalid={!!proxy_error} aria-describedby="proxy-error" />{proxy_error && <p className="field-error" id="proxy-error" role="alert">{proxy_error}</p>}</div></div></section>
      <section className="settings-section"><header><h2>Windows 集成</h2><p>管理窗口关闭与系统启动行为。</p></header><SettingSwitch label="关闭窗口时隐藏到托盘" description="可从托盘重新打开窗口、刷新账号或退出。" checked={draft.minimizeToTray} change={value => set_draft({ ...draft, minimizeToTray: value })}  /><SettingSwitch label="开机启动" description="登录 Windows 后自动运行管理器。" checked={draft.startAtLogin} change={value => set_draft({ ...draft, startAtLogin: value })}  /></section>
      <div className="security-note"><ShieldCheck size={18} /><p>登录凭据使用系统安全存储加密。账号导出文件含有完整凭据，请妥善保管。</p></div>
    </div><footer className="settings-save-bar" role="status"><span className={`draft-status ${dirty ? 'unsaved' : ''}`}><i />{busy ? '正在自动保存…' : proxy_error || interval_error ? '请修正输入，有效后自动保存' : save_failed ? '自动保存失败，输入已保留' : dirty ? '等待自动保存…' : '所有更改已自动保存'}</span>{save_failed && <Button onClick={() => set_retry(value => value + 1)}>重试保存</Button>}</footer><Notice value={notice} clear={() => set_notice(null)} /></section>
}

export function AboutPage({ info }: { info: AppInfo | null }): React.JSX.Element {
  return <section className="about-page"><PageHeader title="关于" description="集中管理 Codex 账号、会话、记忆、提示词、扩展与主题。" /><div className="about-product"><BrandMark /><div><h2>{APP_NAME}</h2><p>{APP_TAGLINE}</p></div></div><section className="about-environment"><h2>本机环境</h2><dl><div><dt>凭据保护</dt><dd><ShieldCheck size={16} />{info ? info.encryptionAvailable ? '系统安全存储可用' : '系统安全存储不可用' : '正在读取…'}</dd></div><div><dt>认证文件</dt><dd className="selectable-path">{info?.authPath || '正在读取…'}</dd></div><div><dt>配置文件</dt><dd className="selectable-path">{info?.configPath || '正在读取…'}</dd></div></dl></section><p className="about-footnote">账号、设置与提示词保存在本机。主题支持预览、导出、备份及应用到 Codex。</p></section>
}
