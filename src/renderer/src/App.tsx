import { BrandMark } from './brand_mark'
import { APP_NAME, APP_TAGLINE } from '../../shared/branding'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, FileText, Info, LayoutDashboard, Palette, PanelLeftClose, PanelLeftOpen, Puzzle, Settings, ShieldCheck, MessagesSquare } from 'lucide-react'
import type { AppInfo, AppSettings, ThemeMode } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { AccountsPage } from './accounts_page'
import { PromptsPage } from './prompts_page'
import { AboutPage, SettingsPage } from './settings_page'
import { ExtensionsPage } from './ExtensionsPage'
import { SessionsPage } from './sessions_page'
import { MemoriesPage } from './memories_page'
import { SkinLibrary } from './skin_library'
import { Button, ConfirmProvider, EmptyState, error_text, Notice } from './ui'
import type { LeaveGuard, NoticeValue } from './ui'

type Page = 'accounts' | 'sessions' | 'memories' | 'prompts' | 'extensions' | 'themes' | 'settings' | 'about'
const navigation = [
  { id: 'accounts', name: '账号管理', icon: LayoutDashboard },
  { id: 'sessions', name: '会话管理', icon: MessagesSquare },
  { id: 'memories', name: '记忆管理', icon: Brain },
  { id: 'prompts', name: '提示词', icon: FileText },
  { id: 'extensions', name: 'MCP / Skills', icon: Puzzle },
  { id: 'themes', name: '主题', icon: Palette },
  { id: 'settings', name: '应用设置', icon: Settings },
  { id: 'about', name: '关于', icon: Info },
] as const

export function App(): React.JSX.Element {
  const [page, set_page] = useState<Page>('accounts')
  const [settings, set_settings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [info, set_info] = useState<AppInfo | null>(null)
  const [preview, set_preview] = useState<ThemeMode | null>(null)
  const [loading, set_loading] = useState(true)
  const [load_failed, set_load_failed] = useState(false)
  const [notice, set_notice] = useState<NoticeValue | null>(null)
  const settings_ref = useRef(settings)
  const save_queue = useRef<Promise<void>>(Promise.resolve())
  const leave_guard = useRef<LeaveGuard | null>(null)
  const navigating = useRef(false)
  const register_guard = useCallback((guard: LeaveGuard | null) => { leave_guard.current = guard }, [])
  const preview_theme = useCallback((mode: ThemeMode | null) => set_preview(mode), [])
  const load = async () => {
    set_loading(true)
    try {
      const [result, app_info] = await Promise.all([window.codexAccounts.getSettings(), window.codexAccounts.info()])
      if (!result.success || !result.data) throw new Error(result.error || '设置读取失败')
      settings_ref.current = result.data; set_settings(result.data); set_info(app_info); set_load_failed(false)
    } catch (error) { set_load_failed(true); set_notice({ text: error_text(error), error: true }) }
    finally { set_loading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { document.querySelector('.content')?.scrollTo(0, 0) }, [page])
  const enqueue_settings = useCallback((resolve_settings: () => AppSettings): Promise<void> => {
    const operation = save_queue.current.catch(() => undefined).then(async () => {
      const next = resolve_settings()
      const result = await window.codexAccounts.saveSettings(next)
      if (!result.success) throw new Error(result.error || '设置保存失败')
      settings_ref.current = next; set_settings(next)
    })
    save_queue.current = operation
    return operation
  }, [])
  const save_preference = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    try { await enqueue_settings(() => ({ ...settings_ref.current, ...patch })) }
    catch (error) { set_notice({ text: error_text(error), error: true }) }
  }, [enqueue_settings])
  const commit_settings = useCallback((next: AppSettings) => enqueue_settings(() => ({ ...next, sidebarCollapsed: settings_ref.current.sidebarCollapsed, viewMode: settings_ref.current.viewMode, accountSort: settings_ref.current.accountSort })), [enqueue_settings])
  useEffect(() => {
    const on_key = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'b' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); void save_preference({ sidebarCollapsed: !settings_ref.current.sidebarCollapsed }) }
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [save_preference])
  const navigate = async (target: Page) => {
    if (page === target || navigating.current) return
    navigating.current = true
    try { if (leave_guard.current && !await leave_guard.current()) return; set_page(target); set_preview(null) }
    finally { navigating.current = false }
  }
  return <div className={`app-shell theme-${preview || settings.themeMode} ${settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <ConfirmProvider>
      <aside className="sidebar"><div className="brand"><BrandMark /><div className="brand-text"><b>{APP_NAME}</b><span>{APP_TAGLINE}</span></div></div><div className="nav-caption">工作空间</div><nav aria-label="主导航">{navigation.map(item => <button type="button" key={item.id} className={page === item.id ? 'active' : ''} aria-label={item.name} aria-current={page === item.id ? 'page' : undefined} title={item.name} onClick={() => void navigate(item.id)}><item.icon size={18} aria-hidden="true" /><span>{item.name}</span></button>)}</nav><div className="sidebar-bottom"><button type="button" className="sidebar-toggle" aria-label={settings.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} title="切换侧栏（Alt+B）" disabled={loading || load_failed} onClick={() => void save_preference({ sidebarCollapsed: !settings.sidebarCollapsed })}>{settings.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>收起侧栏</span><kbd>Alt B</kbd></button><div className="sidebar-security" title={info?.encryptionAvailable ? '系统安全存储可用' : '系统安全存储不可用'}><ShieldCheck size={15} /><span>本地工作空间</span></div></div></aside>
      <main className="content"><div className="window-drag" aria-hidden="true" /><div className="content-inner" key={page}>
        {loading ? <EmptyState loading title="正在打开工作空间" /> : load_failed ? <EmptyState title="无法读取本地设置" description="原始数据不会被覆盖，请检查后重新加载。" action={<Button onClick={() => void load()}>重新加载</Button>} /> : <>
          {page === 'accounts' && <AccountsPage settings={settings} save_preference={save_preference} register_guard={register_guard} />}
          {page === 'sessions' && <SessionsPage />}
          {page === 'memories' && <MemoriesPage register_guard={register_guard} />}
          {page === 'prompts' && <PromptsPage register_guard={register_guard} />}
          {page === 'extensions' && <ExtensionsPage register_guard={register_guard} />}
          {page === 'themes' && <SkinLibrary />}
          {page === 'settings' && <SettingsPage settings={settings} commit={commit_settings} preview_theme={preview_theme} register_guard={register_guard} />}
          {page === 'about' && <AboutPage info={info} />}
        </>}
      </div></main><Notice value={notice} clear={() => set_notice(null)} />
    </ConfirmProvider>
  </div>
}
