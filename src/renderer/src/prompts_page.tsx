import { useEffect, useRef, useState } from 'react'
import { Check, FileText, History, Info, Save } from 'lucide-react'
import type { OperationResult, PromptConfig, PromptPreset } from '../../shared/types'
import { MarkdownView } from './MarkdownView'
import { ActionMenu, Button, EmptyState, error_text, Notice, PageHeader, SearchField, use_confirm, use_leave_guard } from './ui'
import type { NoticeValue, RegisterGuard } from './ui'

export function PromptsPage({ register_guard }: { register_guard: RegisterGuard }): React.JSX.Element {
  const [saved, set_saved] = useState<PromptConfig | null>(null)
  const [draft, set_draft] = useState('')
  const [view_baseline, set_view_baseline] = useState('')
  const [presets, set_presets] = useState<PromptPreset[]>([])
  const [query, set_query] = useState('')
  const [category, set_category] = useState('all')
  const [mode, set_mode] = useState<'edit' | 'preview'>('edit')
  const [panel, set_panel] = useState<'source' | 'history' | null>(null)
  const [loading, set_loading] = useState(true)
  const [failed, set_failed] = useState(false)
  const [busy, set_busy] = useState(false)
  const [notice, set_notice] = useState<NoticeValue | null>(null)
  const running = useRef(false)
  const confirm = use_confirm()
  const dirty = saved !== null && draft !== saved.content
  const edited = draft !== view_baseline
  const active = presets.find(preset => preset.content === draft)
  const load = async () => {
    set_loading(true)
    try {
      const [response, library] = await Promise.all([window.codexAccounts.promptGet(), window.codexAccounts.promptPresets()])
      if (!response.success || !response.data) throw new Error(response.error || '提示词读取失败')
      set_saved(response.data); set_draft(response.data.content); set_view_baseline(response.data.content); set_presets(library); set_failed(false)
    } catch (error) { set_failed(true); set_notice({ text: error_text(error), error: true }) }
    finally { set_loading(false) }
  }
  useEffect(() => { void load() }, [])
  const may_replace = async () => !running.current && (!edited || await confirm({ title: '放弃未保存的提示词？', description: '当前草稿还没有保存到管理器。继续会放弃这些更改。', action: '放弃更改' }))
  use_leave_guard(register_guard, may_replace)
  const run = async (work: () => Promise<OperationResult<unknown>>, message: string, reload = false) => {
    if (running.current) return
    running.current = true; set_busy(true); set_notice(null)
    try {
      const response = await work()
      if (!response.success) throw new Error(response.error || '操作失败')
      if (response.data === 0) return
      if (reload) {
        const current = await window.codexAccounts.promptGet()
        if (!current.success || !current.data) throw new Error(current.error || '保存后读取失败，请重新加载')
        set_saved(current.data); set_draft(current.data.content); set_view_baseline(current.data.content)
      }
      set_notice({ text: message })
    } catch (error) { set_notice({ text: error_text(error), error: true }) }
    finally { running.current = false; set_busy(false) }
  }
  const replace_draft = async (content: string) => { if (content !== draft && await may_replace()) { set_draft(content); set_view_baseline(content) } }
  const scenario = (id: string) => id === 'local-current' ? '当前配置' : presets.find(preset => preset.id === id)?.scenario || '其他'
  const visible = presets.filter(preset => (category === 'all' || scenario(preset.id) === category) && `${preset.name} ${preset.description}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="prompts-page" aria-busy={loading || busy}>
    <PageHeader title="提示词" description="整理工作指令，为每一次任务做好准备。" />
    {loading ? <EmptyState loading title="正在读取提示词" /> : failed || !saved ? <EmptyState title="提示词读取失败" action={<Button onClick={() => void load()}>重新加载</Button>} /> : <div className="prompt-layout">
      <aside className="prompt-library"><header><h2>模板库 <span>{presets.length}</span></h2><p>首项为本机当前指令</p></header><SearchField label="搜索提示词" value={query} on_change={set_query} placeholder="搜索模板" /><label className="prompt-category"><span className="sr-only">提示词分类</span><select aria-label="提示词分类" value={category} onChange={event => set_category(event.target.value)}><option value="all">全部场景</option>{[...new Set(presets.map(preset => scenario(preset.id)))].map(value => <option key={value}>{value}</option>)}</select></label><div className="prompt-preset-list">{visible.map(preset => <button key={preset.id} className={active?.id === preset.id ? 'active' : ''} aria-pressed={active?.id === preset.id} disabled={busy} onClick={() => void replace_draft(preset.content)}><FileText size={16} /><span><b>{preset.name}</b><small>{preset.description}</small></span>{active?.id === preset.id && <Check size={14} />}</button>)}{!visible.length && <p className="inline-empty">没有匹配的模板</p>}</div></aside>
      <div className="prompt-editor panel"><header className="editor-head"><div><h2>工作指令</h2><span className={`draft-status ${dirty ? 'unsaved' : ''}`}><i />{edited ? '有未保存更改' : dirty ? '正在查看模板 · 尚未保存到管理器' : '已保存到管理器'}</span></div><div className="editor-actions"><ActionMenu label="提示词操作" disabled={busy} items={[{ label: '导入提示词', action: () => { void may_replace().then(ok => { if (ok) void run(() => window.codexAccounts.promptImport(), '提示词已导入', true) }) } }, { label: '导出已保存版本', action: () => void run(() => window.codexAccounts.promptExport(), '已导出已保存版本') }, { label: '恢复原提示词', action: () => { void (async () => { if (!await may_replace()) return; if (await confirm({ title: '恢复原提示词？', description: '将恢复管理器保存的原始内容，并新增一条历史记录。', action: '恢复原提示词' })) void run(() => window.codexAccounts.promptReset(), '已恢复原提示词', true) })() } }]} /><Button variant="primary" disabled={busy || !dirty || !draft.trim()} onClick={() => void run(() => window.codexAccounts.promptSave(draft), '已保存到管理器', true)}><Save size={15} />{busy ? '处理中…' : '保存'}</Button></div></header>
        <div className="editor-toolbar"><div className="segmented" aria-label="提示词显示方式"><button aria-pressed={mode === 'edit'} onClick={() => set_mode('edit')}>编辑</button><button aria-pressed={mode === 'preview'} onClick={() => set_mode('preview')}>阅读预览</button></div><div className="editor-tools"><Button variant="ghost" aria-expanded={panel === 'source'} onClick={() => set_panel(panel === 'source' ? null : 'source')}><Info size={15} />来源</Button><Button variant="ghost" aria-expanded={panel === 'history'} onClick={() => set_panel(panel === 'history' ? null : 'history')}><History size={15} />历史 {saved.history.length}</Button></div></div>
        {panel && <div className="prompt-accessory">{panel === 'source' ? <><h3>{active?.source || '自定义草稿'}</h3><p>{active?.sourceWarning || '此内容保存在管理器中，不会自动写入 Codex 的指令文件。'}</p>{active?.stars !== undefined && <p>仓库关注：{active.stars.toLocaleString()} 星 · {active.license} · 核验于 {active.checkedAt?.slice(0, 10)}</p>}{active?.sourceUrl && <a href={active.sourceUrl} target="_blank" rel="noreferrer">查看固定版本来源</a>}</> : <><h3>已保存的历史</h3>{!saved.history.length ? <p>保存新版本后，历史记录会出现在这里。</p> : <div className="history-list">{[...saved.history].reverse().map((version, index) => <button key={version.id} disabled={busy} onClick={() => void replace_draft(version.content)}><span>版本 {saved.history.length - index}</span><time>{new Date(version.createdAt).toLocaleString('zh-CN')}</time><span>载入草稿</span></button>)}</div>}</>}</div>}
        <div className="editor-content">{mode === 'edit' ? <textarea aria-label="提示词编辑器" value={draft} onChange={event => set_draft(event.target.value)} disabled={busy} spellCheck={false} /> : <MarkdownView source={draft} />}</div>
        <footer className="editor-footer"><span>{draft.length.toLocaleString()} 字符</span><span>仅保存到管理器，不会自动应用到 Codex</span></footer>
      </div>
    </div>}
    <Notice value={notice} clear={() => set_notice(null)} />
  </section>
}
