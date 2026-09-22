import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, Download, Image, Moon, Search, Sparkles, Sun, X } from 'lucide-react'
import type { SkinMode, SkinPreview, SkinPreviewView, SkinSummary } from '../../shared/skins'
import type { ThemeRuntimeStatus } from '../../shared/theme_runtime'
import { SKIN_CATEGORY_LABELS, SKIN_CONTENT_KIND_LABELS } from '../../shared/skins'
import { filter_skins } from '../../shared/skinFilter'
import { useDialogFocus } from './useDialogFocus'
import { Button, Dialog, EmptyState, error_text, Notice, PageHeader, use_confirm } from './ui'

type PreviewView = SkinPreviewView | 'art'

export function SkinLibrary(): React.JSX.Element {
  const [skins, set_skins] = useState<SkinSummary[]>([])
  const [query, set_query] = useState('')
  const [category, set_category] = useState('all')
  const [mode, set_mode] = useState<SkinMode>('light')
  const [preview, set_preview] = useState<SkinPreview | null>(null)
  const [preview_mode, set_preview_mode] = useState<SkinMode>('light')
  const [view, set_view] = useState<PreviewView>('home')
  const [preview_motion, set_preview_motion] = useState(true)
  const [preview_html, set_preview_html] = useState('')
  const [preview_loading, set_preview_loading] = useState(false)
  const [preview_error, set_preview_error] = useState('')
  const [loading, set_loading] = useState(true)
  const [failed, set_failed] = useState(false)
  const [reload_key, set_reload_key] = useState(0)
  const [busy_id, set_busy_id] = useState<string | null>(null)
  const [notice, set_notice] = useState<{ text: string; error: boolean } | null>(null)
  const [runtime, set_runtime] = useState<ThemeRuntimeStatus | null>(null)
  const [show_connection, set_show_connection] = useState(false)
  const [show_backups, set_show_backups] = useState(false)
  const preview_opener = useRef<HTMLElement | null>(null)
  const preview_frame = useRef<HTMLIFrameElement | null>(null)
  const runtime_busy = useRef(false)
  const confirm = use_confirm()
  const close_preview = useCallback(() => { if (!busy_id) set_preview(null) }, [busy_id])
  useDialogFocus(!!preview, close_preview, preview_opener.current)
  useEffect(() => {
    const on_message = (event: MessageEvent): void => {
      if (!preview_frame.current || event.source !== preview_frame.current.contentWindow) return
      if (event.data?.type === 'original-preview-close') close_preview()
      if (event.data?.type === 'original-preview-tab') {
        const controls = [...(preview_frame.current.closest('.modal')?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || [])].filter(item => item.getClientRects().length > 0)
        const index = controls.indexOf(preview_frame.current)
        controls[(index + (event.data.backwards ? -1 : 1) + controls.length) % controls.length]?.focus()
      }
    }
    window.addEventListener('message', on_message)
    return () => window.removeEventListener('message', on_message)
  }, [close_preview])

  const refresh_runtime = async () => {
    const result = await window.codexSkins.status()
    if (!result.success || !result.data) throw Error(result.error || '主题状态读取失败')
    set_runtime(result.data)
  }
  useEffect(() => { void refresh_runtime().catch(error => set_notice({ text: error_text(error), error: true })) }, [])
  const runtime_action = async (work: () => Promise<{ success: boolean; error?: string; data?: unknown }>, message: string | ((data: unknown) => string)) => {
    if (runtime_busy.current) return
    runtime_busy.current = true
    set_busy_id('runtime')
    try {
      const result = await work()
      if (!result.success) throw Error(result.error || '主题操作失败')
      await refresh_runtime()
      set_notice({ text: typeof message === 'function' ? message(result.data) : message, error: false })
    } catch (error) { set_notice({ text: error_text(error), error: true }) }
    finally { runtime_busy.current = false; set_busy_id(null) }
  }
  useEffect(() => {
    let active = true
    set_loading(true)
    void window.codexSkins.list().then(result => {
      if (!active) return
      if (!result.success || !result.data) throw Error(result.error || '主题资源读取失败')
      set_skins(result.data); set_failed(false)
    }).catch(error => { if (active) { set_failed(true); set_notice({ text: error_text(error), error: true }) } })
      .finally(() => { if (active) set_loading(false) })
    return () => { active = false }
  }, [reload_key])
  useEffect(() => {
    let active = true
    set_preview_html(''); set_preview_error('')
    if (!preview || view === 'art') { set_preview_loading(false); return }
    set_preview_loading(true)
    void window.codexSkins.renderPreview(preview.id, preview_mode, view, preview_motion).then(result => {
      if (!active) return
      if (!result.success || !result.data) throw Error(result.error || '界面预览生成失败')
      set_preview_html(result.data)
    }).catch(error => { if (active) set_preview_error(error_text(error)) })
      .finally(() => { if (active) set_preview_loading(false) })
    return () => { active = false }
  }, [preview?.id, preview_mode, view, preview_motion])

  const visible = useMemo(() => filter_skins(skins, query, category), [skins, query, category])
  const open_preview = async (skin: SkinSummary) => {
    preview_opener.current = document.activeElement as HTMLElement
    set_busy_id(skin.id)
    try {
      const result = await window.codexSkins.preview(skin.id)
      if (!result.success || !result.data) throw Error(result.error || '主题预览读取失败')
      set_preview_mode(mode); set_view('home'); set_preview_motion(runtime?.motion_enabled ?? true); set_preview(result.data)
    } catch (error) { set_notice({ text: error_text(error), error: true }) }
    finally { set_busy_id(null) }
  }
  const apply_theme = async (skin: SkinSummary) => {
    if (!await confirm({ title: `应用“${skin.name}”？`, description: '应用后将跟随 Codex 明暗设置。原生等外观会去重备份，内置主题可随时从主题馆重新应用，无需备份。', action: '应用主题' })) return
    await runtime_action(() => window.codexSkins.apply(skin.id), data => data ? `已应用“${skin.name}”，原外观备份可用` : `已应用“${skin.name}”，内置主题无需备份`)
  }
  const export_theme = async (skin: SkinSummary) => {
    set_busy_id(skin.id)
    try {
      const result = await window.codexSkins.export(skin.id)
      if (!result.success) throw Error(result.error || '主题导出失败')
      if (result.data !== 0) set_notice({ text: '完整主题包已导出', error: false })
    } catch (error) { set_notice({ text: error_text(error), error: true }) }
    finally { set_busy_id(null) }
  }

  return <section className="panel-page skin-page original-gallery" aria-busy={loading || !!busy_id}>
    <PageHeader title="主题馆" description="为每一种专注，找到自己的风景。" actions={<span className="original-edition"><Sparkles size={15} aria-hidden="true" />{skins.length || '—'} 组主题 · 双重明暗</span>} />
    <Notice value={notice} clear={() => set_notice(null)} />
    <div className="original-connection">
      <button type="button" className="original-status" aria-expanded={show_connection} onClick={() => set_show_connection(value => !value)}><i className={runtime?.connected ? 'connected' : ''} /><span>{runtime?.connected ? 'Codex 已连接' : '连接 Codex 以应用主题'}</span><ChevronDown size={14} /></button>
      <div className="original-runtime-actions"><label className="original-motion"><input type="checkbox" checked={runtime?.motion_enabled ?? true} disabled={!!busy_id || !runtime} onChange={event => void runtime_action(() => window.codexSkins.setMotion(event.target.checked), '环境动效偏好已保存')} /><span>环境动效</span></label><Button variant="ghost" disabled={!!busy_id} onClick={() => set_show_backups(true)}>主题备份{runtime?.backups.length ? ` · ${runtime.backups.length}` : ''}</Button></div>
    </div>
    {(show_connection || (runtime && !runtime.connected)) && <div className="original-connection-detail"><p>{runtime?.message || '正在检查本地连接…'}</p><div><Button disabled={!!busy_id} onClick={() => void runtime_action(async () => { await refresh_runtime(); return { success: true } }, '连接状态已更新')}>检测连接</Button>{!runtime?.connected && <Button disabled={!!busy_id} onClick={() => void runtime_action(() => window.codexSkins.launch(), '已连接 Codex')}>连接运行中的 Codex</Button>}<Button disabled={!!busy_id || !runtime?.connected} onClick={() => void runtime_action(() => window.codexSkins.backup(), data => data ? '当前外观备份可用（相同内容不重复保存）' : '内置主题可从主题馆重新应用，无需备份')}>备份当前主题</Button></div></div>}
    <div className="original-toolbar"><label className="original-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索主题" value={query} onChange={event => set_query(event.target.value)} placeholder="搜索主题、风格或氛围" />{query && <button aria-label="清除搜索" onClick={() => set_query('')}><X size={14} /></button>}</label><ModeSwitch mode={mode} change={set_mode} /></div>
    <div className="original-filter-row"><div className="original-categories" aria-label="主题分类">{[['all','全部作品'], ...Object.entries(SKIN_CATEGORY_LABELS)].map(([value,label]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => set_category(value)}>{label}</button>)}</div><span className="original-result-count">{visible.length} 组作品</span></div>
    {loading ? <EmptyState loading title="正在读取主题" /> : failed ? <EmptyState title="主题资源读取失败" action={<Button onClick={() => set_reload_key(value => value + 1)}>重新加载</Button>} /> : !visible.length ? <EmptyState title="暂时没有匹配的主题" description="试试“自然”“二次元”或“高对比”。" action={<Button onClick={() => { set_query(''); set_category('all') }}>清除筛选</Button>} /> : <div className="original-grid">{visible.map((skin, index) => <article className={`original-card ${runtime?.active_id === skin.id ? 'is-current' : ''}`} key={skin.id}>
      <button type="button" className="original-card-preview" aria-label={`预览 ${skin.name}`} disabled={!!busy_id} onClick={() => void open_preview(skin)}><img src={skin.thumbnails[mode]} alt={`${skin.name} · ${mode === 'light' ? '浅色' : '深色'}首页界面预览`} loading="lazy" draggable={false} /><span className="original-preview-hint">探索主题 <ArrowUpRight size={14} /></span>{runtime?.active_id === skin.id && <span className="original-active-badge"><Check size={13} />使用中</span>}</button>
      <div className="original-card-body"><div className="original-card-topline"><span>{SKIN_CATEGORY_LABELS[skin.category]} · {SKIN_CONTENT_KIND_LABELS[skin.content_kind]}</span><span>{String(index+1).padStart(2,'0')}</span></div><h2>{skin.name}</h2><p>{skin.description}</p><div className="original-tags">{skin.tags.slice(0,3).map(tag => <span key={tag}>{tag}</span>)}{skin.motion && <span className="motion-tag"><Sparkles size={11} />轻动效</span>}</div><div className="original-card-actions"><Button onClick={() => void open_preview(skin)} disabled={!!busy_id}>查看主题</Button><Button variant="primary" disabled={!!busy_id || !runtime?.connected} title={!runtime?.connected ? '连接 Codex 后即可应用' : undefined} onClick={() => void apply_theme(skin)}>{runtime?.active_id === skin.id ? '重新应用' : '应用主题'}</Button><Button variant="ghost" disabled={!!busy_id} aria-label={`导出 ${skin.name}`} title="导出完整主题包" onClick={() => void export_theme(skin)}><Download size={16} /></Button></div></div>
    </article>)}</div>}
    <p className="original-gallery-note">主题图像由 AI 绘画制作，来源以各主题标记为准。每组均含浅色与深色外观；环境动效遵循系统“减少动态效果”设置。</p>

    {show_backups && <Dialog title="主题备份" description="仅保存外观，不包含会话和账号。内置主题无需备份，可从主题馆重新应用。" busy={!!busy_id} close={() => set_show_backups(false)} className="backup-panel">{runtime?.backups.length ? runtime.backups.map(backup => <div className="theme-backup-row" key={backup.id}><div><b>{backup.theme_name || '无法识别的主题'}</b><p>{backup.name}</p><p>{new Date(backup.created_at).toLocaleString('zh-CN')} · {backup.windows} 个窗口</p>{backup.unavailable_reason && <p className="original-backup-warning">{backup.unavailable_reason}</p>}</div><div className="theme-backup-actions"><Button disabled={!!busy_id || !runtime.connected || !backup.available} onClick={() => void confirm({ title: '恢复此主题备份？', description: '恢复前会去重备份原生等外观；内置主题无需备份。', action: '恢复主题' }).then(ok => { if (ok) void runtime_action(() => window.codexSkins.restore(backup.id), '主题已恢复') })}>恢复</Button><Button variant="ghost" className="danger-text" disabled={!!busy_id} aria-label={`删除备份：${backup.theme_name || '无法识别的主题'}`} onClick={() => void confirm({ title: '删除此主题备份？', description: `将永久删除“${backup.theme_name || '无法识别的主题'}”的这份备份，不影响当前主题、会话或账号。`, action: '删除备份', danger: true }).then(ok => { if (ok) void runtime_action(() => window.codexSkins.removeBackup(backup.id), '主题备份已删除') })}>删除</Button></div></div>) : <EmptyState title="暂无主题备份" description="备份原生等外观后会在这里显示；内置主题无需备份。" />}</Dialog>}

    {preview && <div className="backdrop original-preview-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close_preview() }}><div className="modal original-preview-modal" aria-labelledby="original-preview-title">
      <header className="original-preview-head"><div><span>{SKIN_CATEGORY_LABELS[preview.category]} · {SKIN_CONTENT_KIND_LABELS[preview.content_kind]}</span><h2 id="original-preview-title">{preview.name}</h2></div><button type="button" className="original-close" aria-label="关闭主题预览" onClick={close_preview} disabled={!!busy_id}><X size={20} /></button></header>
      <div className="original-preview-controls"><div className="original-view-tabs" aria-label="预览内容">{([['home','首页'],['task','任务页'],...(preview.ui_revision === 1 ? [['settings','设置'],['components','组件状态']] : []),['art','原画']] as [PreviewView,string][]).map(([value,label]) => <button type="button" key={value} aria-label={`${label}预览`} aria-pressed={view === value} onClick={() => set_view(value)}>{value === 'art' && <Image size={14} />}{label}</button>)}</div><div className="original-preview-options">{preview.motion && <label className="original-motion"><input type="checkbox" checked={preview_motion} onChange={event => set_preview_motion(event.target.checked)} />预览动效</label>}<ModeSwitch mode={preview_mode} change={set_preview_mode} /></div></div>
      <div className={`original-preview-stage ${view === 'art' ? 'art-stage' : ''}`}>
        {view === 'art' ? <img src={preview.images[preview_mode]} alt={`${preview.name} · ${SKIN_CONTENT_KIND_LABELS[preview.content_kind]} · ${preview_mode === 'light' ? '浅色' : '深色'}主图`} /> : preview_loading ? <EmptyState loading title="正在渲染主题预览" /> : preview_error ? <EmptyState title="预览暂不可用" description={preview_error} /> : preview_html && <iframe ref={preview_frame} title={`${preview.name}界面预览，可滚动查看，Esc 关闭`} sandbox="allow-scripts" srcDoc={preview_html} tabIndex={0} />}
      </div>
      <footer className="original-preview-footer"><div><b>{preview.tagline}</b><p>隔离示例界面 · 使用同一主题引擎；实际布局取决于 Codex 版本。</p></div><div><Button disabled={!!busy_id} onClick={() => void export_theme(preview)}><Download size={15} />导出</Button><Button variant="primary" disabled={!!busy_id || !runtime?.connected} onClick={() => void apply_theme(preview)}>应用到 Codex</Button></div></footer>
    </div></div>}
  </section>
}

function ModeSwitch({ mode, change }: { mode: SkinMode; change: (mode: SkinMode) => void }): React.JSX.Element {
  return <div className="original-mode-switch" aria-label="预览明暗模式"><button type="button" aria-label="浅色预览" aria-pressed={mode === 'light'} onClick={() => change('light')}><Sun size={15} />浅色</button><button type="button" aria-label="深色预览" aria-pressed={mode === 'dark'} onClick={() => change('dark')}><Moon size={15} />深色</button></div>
}
