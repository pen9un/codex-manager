import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Bot, CheckCircle2, Download, Folder, MessageSquare, RefreshCw, Terminal, Trash2, User, X, CircleAlert } from 'lucide-react'
import type { SessionBackupSummary, SessionCatalog, SessionDeletePreview, SessionDetail, SessionExportRequest, SessionExportScope, SessionMessageBlock } from '../../shared/types'
import { SessionDivider } from './session_divider'
import { Button, Dialog, EmptyState, PageHeader, SearchField, StatusBadge, error_text, use_confirm } from './ui'

const scopes: Array<{ id: SessionExportScope; title: string; description: string }> = [
  { id: 'user', title: '仅用户指令', description: '只导出用户消息' },
  { id: 'conversation', title: '用户 + AI', description: '导出用户消息和 AI 回复' },
  { id: 'with_tools', title: '包含工具', description: 'AI 回复中包含工具调用与结果' },
  { id: 'raw', title: '全部原始记录', description: '追加系统、开发者、推理等原始记录' },
]

function date_text(value?: string): string { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未知时间' }
function project_id(path?: string): string { return path ? `project:${path.replaceAll('\\', '/').toLowerCase()}` : 'project:__unassigned__' }

export function SessionsPage(): React.JSX.Element {
  const [catalog, set_catalog] = useState<SessionCatalog | null>(null)
  const [detail, set_detail] = useState<SessionDetail | null>(null)
  const [project, set_project] = useState('all')
  const [blocks, set_blocks] = useState<string[]>([])
  const [query, set_query] = useState('')
  const [project_query, set_project_query] = useState('')
  const [selection_mode, set_selection_mode] = useState(false)
  const [export_scope, set_export_scope] = useState<SessionExportScope>('conversation')
  const [export_open, set_export_open] = useState(false)
  const [detail_busy, set_detail_busy] = useState(false)
  const detail_request = useRef(0)
  const [export_target, set_export_target] = useState<'context' | 'current'>('context')
  const [busy, set_busy] = useState(false)
  const [notice, set_notice] = useState<string | null>(null)
  const [notice_tone, set_notice_tone] = useState<'info' | 'success' | 'error'>('info')
  const [delete_preview, set_delete_preview] = useState<SessionDeletePreview | null>(null)
  const [delete_busy, set_delete_busy] = useState(false)
  const [undo_operation, set_undo_operation] = useState<string | null>(null)
  const [undo_selection, set_undo_selection] = useState<string[]>([])
  const [backups_open, set_backups_open] = useState(false)
  const [backups, set_backups] = useState<SessionBackupSummary[]>([])
  const confirm = use_confirm()
  const show_notice = (text: string | null, tone: 'info' | 'success' | 'error' = 'info') => { set_notice(text); if (text) set_notice_tone(tone) }

  const load = async (refresh = false) => {
    set_busy(true); show_notice(null)
    try {
      const result = refresh ? await window.codexAccounts.sessions.refresh() : await window.codexAccounts.sessions.list()
      if (!result.success || !result.data) throw new Error(result.error || '会话读取失败')
      set_catalog(result.data)
      if (result.data.warnings?.length) show_notice(result.data.warnings.join(' '))
    } catch (error) { show_notice(error_text(error), 'error') } finally { set_busy(false) }
  }
  const open_detail = async (id: string, more = false) => {
    const generation = ++detail_request.current
    set_detail_busy(true); show_notice(null)
    if (!more) { set_detail(null); set_blocks([]); set_selection_mode(false); set_delete_preview(null) }
    try {
      const result = await window.codexAccounts.sessions.detail(id, more ? detail?.nextCursor : undefined)
      if (generation !== detail_request.current) return
      if (!result.success || !result.data) throw new Error(result.error || '会话读取失败')
      const data = result.data
      set_detail(current => more && current?.summary.id === id ? { ...data, summary: current.summary, blocks: [...current.blocks, ...data.blocks] } : data)
    } catch (error) { if (generation === detail_request.current) show_notice(error_text(error), 'error') }
    finally { if (generation === detail_request.current) set_detail_busy(false) }
  }
  const select_project = (id: string) => {
    detail_request.current++; set_detail_busy(false); set_project(id); set_detail(null); set_blocks([]); set_selection_mode(false); set_delete_preview(null)
  }
  useEffect(() => { void load() }, [])
  const projects = useMemo(() => {
    const filtered = (catalog?.projects || []).filter(item => !project_query.trim() || `${item.name} ${item.path || ''}`.toLowerCase().includes(project_query.toLowerCase()))
    const unassigned = filtered.filter(item => item.id === 'project:__unassigned__')
    return [...unassigned, ...filtered.filter(item => item.id !== 'project:__unassigned__')]
  }, [catalog, project_query])
  const sessions = useMemo(() => (catalog?.sessions || []).filter(item => (project === 'all' || (item.projectId || project_id(item.projectPath)) === project) && (!query.trim() || `${item.title} ${item.projectPath || ''} ${item.preview || ''}`.toLowerCase().includes(query.toLowerCase()))), [catalog, project, query])
  const selected = detail ? detail.blocks.filter(block => blocks.includes(block.id)) : []
  const toggle_block = (block: SessionMessageBlock) => set_blocks(current => current.includes(block.id) ? current.filter(item => item !== block.id) : [...current, block.id])
  const request: SessionExportRequest = export_target === 'current' && detail ? { scope: export_scope, sessionIds: [detail.summary.id], ...(blocks.length ? { selectedBlockIds: { [detail.summary.id]: blocks } } : {}) } : detail && blocks.length ? { scope: export_scope, sessionIds: [detail.summary.id], selectedBlockIds: { [detail.summary.id]: blocks } } : project !== 'all' ? { scope: export_scope, projectId: project } : detail ? { scope: export_scope, sessionIds: [detail.summary.id] } : { scope: export_scope }
  const target_label = export_target === 'current' && detail && !blocks.length ? detail.summary.title : blocks.length ? `当前会话的 ${blocks.length} 个消息块` : project !== 'all' ? (catalog?.projects.find(item => item.id === project)?.name || '当前项目') : detail?.summary.title || '全部会话'
  const export_now = async () => { set_busy(true); show_notice(null); try { const result = await window.codexAccounts.sessions.export(request); if (!result.success) throw new Error(result.error || '导出失败'); set_export_open(false); show_notice(result.data === 0 ? '已取消导出' : 'Markdown 导出已完成', 'success') } catch (error) { show_notice(error_text(error), 'error') } finally { set_busy(false) } }
  const refresh_after_mutation = async (session_id: string) => {
    const catalog_result = await window.codexAccounts.sessions.refresh()
    if (!catalog_result.success || !catalog_result.data) throw new Error(catalog_result.error || '会话列表刷新失败')
    set_catalog(catalog_result.data)
    const detail_result = await window.codexAccounts.sessions.detail(session_id)
    if (!detail_result.success || !detail_result.data) throw new Error(detail_result.error || '会话详情刷新失败')
    set_detail(detail_result.data); set_detail_busy(false)
  }
  const preview_delete = async () => {
    if (!detail || !blocks.length) return
    set_delete_busy(true); show_notice(null)
    try {
      const result = await window.codexAccounts.sessions.deletePreview({ sessionId: detail.summary.id, selectedBlockIds: blocks })
      if (!result.success || !result.data) throw new Error(result.error || '删除预览失败')
      set_delete_preview(result.data)
    } catch (error) { show_notice(error_text(error), 'error') } finally { set_delete_busy(false) }
  }
  const delete_memory_action = () => {
    if (!selection_mode) { set_selection_mode(true); set_blocks([]); set_delete_preview(null); return }
    void preview_delete()
  }
  const delete_now = async () => {
    if (!detail || !delete_preview) return
    set_delete_busy(true); show_notice(null)
    try {
      const result = await window.codexAccounts.sessions.delete({ sessionId: detail.summary.id, selectedBlockIds: blocks, previewToken: delete_preview.previewToken })
      if (!result.success || !result.data) throw new Error(result.error || '删除失败')
      const session_id = detail.summary.id; set_delete_preview(null); set_undo_selection(blocks); set_blocks([]); set_selection_mode(false); set_undo_operation(result.data.operationId)
      show_notice(`已成功删除 ${result.data.deletedTurnCount} 个轮次，备份已保留，可立即撤销`, 'success')
      try { await refresh_after_mutation(session_id) }
      catch (error) { show_notice(`删除已成功，备份已保留；页面刷新失败：${error_text(error)}。请刷新列表后重新打开会话。`, 'info') }
    } catch (error) { set_delete_preview(null); show_notice(`删除未完成：${error_text(error)}。当前会话和选择已保留，请重新预览后重试。`, 'error') } finally { set_delete_busy(false) }
  }
  const restore_now = async (operation_id: string) => {
    set_delete_busy(true); show_notice(null)
    try {
      const result = await window.codexAccounts.sessions.restore(operation_id)
      if (!result.success || !result.data) throw new Error(result.error || '撤销删除失败')
      set_blocks(undo_selection); set_selection_mode(undo_selection.length > 0); set_undo_selection([]); set_undo_operation(null); set_backups_open(false)
      if (detail) await refresh_after_mutation(detail.summary.id)
      show_notice('已撤销删除，原始会话已恢复', 'success')
    } catch (error) { show_notice(error_text(error), 'error') } finally { set_delete_busy(false) }
  }
  const open_backups = async () => {
    set_delete_busy(true); show_notice(null)
    try {
      const result = await window.codexAccounts.sessions.backups(detail?.summary.id)
      if (!result.success || !result.data) throw new Error(result.error || '备份读取失败')
      set_backups(result.data); set_backups_open(true)
    } catch (error) { show_notice(error_text(error), 'error') } finally { set_delete_busy(false) }
  }
  const remove_backup = async (operation_id: string) => {
    const accepted = await confirm({ title: '删除会话备份', description: '删除后无法撤销，请确认不再需要这份备份。', action: '删除备份', danger: true })
    if (!accepted) return
    set_delete_busy(true); show_notice(null)
    try {
      const result = await window.codexAccounts.sessions.removeBackup(operation_id)
      if (!result.success) throw new Error(result.error || '备份删除失败')
      set_backups(current => current.filter(item => item.id !== operation_id)); set_undo_operation(current => current === operation_id ? null : current); show_notice('备份已删除', 'success')
    } catch (error) { show_notice(error_text(error), 'error') } finally { set_delete_busy(false) }
  }

  return <div className="sessions-page">
    <PageHeader title="会话管理" description="浏览本地 Codex 会话，按项目整理并导出 Markdown。" actions={<><Button variant="secondary" onClick={() => void load(true)} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} />刷新</Button><Button variant="primary" onClick={() => { set_export_target('context'); set_export_open(true) }} disabled={busy || (!catalog?.sessions.length)}><Download size={16} />导出</Button></>} />
    {notice && <div className={`session-notice ${notice_tone}`} role={notice_tone === 'error' ? 'alert' : 'status'}>{notice_tone === 'error' ? <CircleAlert size={16} aria-hidden="true" /> : notice_tone === 'success' ? <CheckCircle2 size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}<span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => show_notice(null)}><X size={15} /></button></div>}
    {!catalog ? <EmptyState loading title="正在读取 Codex 会话" description="正在读取本地会话索引。" /> : !catalog.sessions.length ? <EmptyState title="还没有发现会话" description={`探测路径：${catalog.sourcePath || '未找到 Codex Home'}`} action={<Button onClick={() => void load(true)}>重新扫描</Button>} /> : <div className="sessions-workbench">
      <aside className="session-projects" tabIndex={0} aria-label="项目列表"><div className="session-pane-head"><h2>项目</h2><span>{catalog.projects.length}</span></div><SearchField value={project_query} on_change={set_project_query} placeholder="搜索项目" label="搜索项目" /><button type="button" className={`project-row ${project === 'all' ? 'active' : ''}`} onClick={() => select_project('all')}><Folder size={16} /><span>全部项目</span><b>{catalog.sessions.length}</b></button>{projects.map(item => <button type="button" className={`project-row ${project === item.id ? 'active' : ''}`} key={item.id} onClick={() => select_project(item.id)}><Folder size={16} /><span title={item.path || item.name}>{item.name}</span><b>{item.sessionCount}</b></button>)}</aside>
      <SessionDivider index={0} />
      <section className="session-list" tabIndex={0} aria-label="会话列表"><div className="session-pane-head"><h2>会话</h2><span>{sessions.length}</span></div><SearchField value={query} on_change={set_query} placeholder="搜索标题、项目或指令" label="搜索会话" />{sessions.map(item => <div className={`session-row ${detail?.summary.id === item.id ? 'active' : ''}`} key={item.id}><button type="button" className="session-row-main" onClick={() => void open_detail(item.id)}><span className="session-row-title" title={item.title}>{item.title}</span><span className="session-row-preview">{item.preview || '暂无用户指令'}</span><span className="session-row-meta">{date_text(item.updatedAt)} · {item.messageCountKnown === false ? '按需读取正文' : `${item.messageCount} 个消息块`} {item.archived && <StatusBadge tone="neutral">归档</StatusBadge>}</span></button></div>)}</section>
      <SessionDivider index={1} />
      <section className={`session-detail ${detail || detail_busy ? 'is-open' : ''}`}>{detail ? <><div className="session-detail-head"><div><div className="eyebrow">{detail.summary.projectPath || '未归属项目'}</div><h2>{detail.summary.title}</h2><p>{detail.summary.id} · {date_text(detail.summary.startedAt)} — {date_text(detail.summary.updatedAt)}</p></div><div className="session-detail-actions"><Button variant="secondary" onClick={() => { set_export_target('current'); set_export_open(true) }}><Download size={16} />导出当前会话</Button><Button variant="secondary" onClick={() => void open_backups()} disabled={delete_busy}><ArchiveRestore size={16} />备份</Button><Button variant="danger" onClick={delete_memory_action} disabled={delete_busy || (selection_mode && !blocks.length)}><Trash2 size={16} />删除会话记忆</Button><Button aria-label="关闭会话详情" onClick={() => { detail_request.current++; set_detail(null); set_blocks([]); set_selection_mode(false); set_delete_preview(null); set_detail_busy(false) }}><X size={16} /></Button></div></div>{selection_mode && <div className="session-selection-bar"><span>已选 {selected.length} 个消息块</span><button type="button" onClick={() => set_blocks(detail.blocks.map(block => block.id))}>选择已加载消息</button><button type="button" onClick={() => set_blocks([])}>清空</button><button type="button" className="selection-exit" onClick={() => { set_selection_mode(false); set_blocks([]) }}>退出选择</button></div>}<div className="session-timeline" tabIndex={0} aria-label="会话详情">{detail.blocks.map(block => <article className={`message-block ${block.role} ${selection_mode ? 'is-selectable' : ''}`} key={block.id}>{selection_mode && <label className="message-check"><input type="checkbox" checked={blocks.includes(block.id)} onChange={() => toggle_block(block)} aria-label={`选择${block.role === 'user' ? '用户' : 'AI'}消息`} /></label>}<div className="message-avatar">{block.role === 'user' ? <User size={16} /> : <Bot size={16} />}</div><div className="message-content"><div className="message-label">{block.role === 'user' ? '用户指令' : 'Codex 回复'}<time>{date_text(block.timestamp)}</time></div><div className="message-text">{block.text || '（工具执行中）'}</div>{block.tools.length > 0 && <details className="message-tools"><summary><Terminal size={14} />工具调用与结果（{block.tools.length}）</summary>{block.tools.map(tool => <div className="tool-card" key={tool.id}><code>{tool.name || '工具'}</code>{tool.input && <pre>{tool.input}</pre>}{tool.result && <pre>{tool.result}</pre>}</div>)}</details>}</div></article>)}{detail.nextCursor && <Button variant="secondary" disabled={detail_busy} onClick={() => void open_detail(detail.summary.id, true)}>{detail_busy ? '正在加载…' : '加载更多消息'}</Button>}</div></> : <EmptyState loading={detail_busy} title={detail_busy ? "正在读取会话详情" : "选择一个会话"} description="从左侧列表打开会话详情。" />}</section>
    </div>}
    {export_open && <Dialog title="导出 Codex 会话" description={`目标：${target_label}`} close={() => set_export_open(false)} busy={busy} actions={<><Button onClick={() => set_export_open(false)} disabled={busy}>取消</Button><Button variant="primary" onClick={() => void export_now()} disabled={busy || (blocks.length === 0 && selected.length === 0 && !catalog?.sessions.length)}>{busy ? '正在导出…' : '导出 Markdown'}</Button></>}><div className="export-scope-grid">{scopes.map(scope => <button type="button" className={`export-scope ${export_scope === scope.id ? 'active' : ''}`} aria-pressed={export_scope === scope.id} key={scope.id} onClick={() => set_export_scope(scope.id)}><strong>{scope.title}</strong><span>{scope.description}</span></button>)}</div>{export_scope === 'raw' && <div className="raw-warning"><Archive size={16} />此范围会包含系统、开发者、推理、命令输出和项目路径等原始内容，请确认导出文件的保存位置。</div>}<p className="export-summary"><MessageSquare size={15} />{selected.length ? `将导出当前会话选中的 ${selected.length} 个消息块。` : '未选择消息块时将导出目标中的完整会话。'}</p></Dialog>}
    {delete_preview && detail && <Dialog className="delete-dialog" title="确认删除 Codex 本地记忆" description="这会修改本地 Session 文件并删除选中的 Codex 本地记忆；删除前会创建备份，完成后可立即撤销。" close={() => set_delete_preview(null)} busy={delete_busy} actions={<><Button onClick={() => set_delete_preview(null)} disabled={delete_busy}>取消</Button><Button variant="danger" onClick={() => void delete_now()} disabled={delete_busy}>{delete_busy ? '正在安全删除…' : '确认删除记忆'}</Button></>}><div className="delete-summary"><div className="delete-context"><div><span>项目</span><strong>{detail.summary.projectName || detail.summary.projectPath || '未归属项目'}</strong></div><div><span>会话标题</span><strong>{detail.summary.title}</strong></div></div><div className="delete-danger-callout"><Trash2 size={17} aria-hidden="true" /><div><strong>删除此会话的本地记忆（对话历史）</strong><span>确认后会从源 Session 文件中移除选中消息所属的完整轮次，包含用户指令、AI 回复、工具调用、工具结果和关联原始记录。已加载的上下文、压缩摘要及独立记忆文件可能仍保留相关内容；建议退出 Codex 后操作。</span></div></div><div className="delete-count-grid"><div className="delete-stat"><b>{delete_preview.turnIds.length}</b><span>待删除轮次</span></div><div className="delete-stat"><b>{delete_preview.userBlockCount}</b><span>用户指令</span></div><div className="delete-stat"><b>{delete_preview.assistantBlockCount}</b><span>AI 回复</span></div><div className="delete-stat"><b>{delete_preview.toolRecordCount}</b><span>工具记录</span></div><div className="delete-stat"><b>{delete_preview.rawRecordCount}</b><span>原始记录</span></div><div className="delete-stat"><b>{delete_preview.fileCount}</b><span>涉及文件</span></div></div>{delete_preview.warnings.map(warning => <p className="delete-warning" key={warning}>{warning}</p>)}<div className="delete-backup-note"><Archive size={17} aria-hidden="true" /><div><strong>可撤销保障</strong><span>删除前自动备份，完成后可从“备份”或顶部撤销提示恢复。</span></div></div></div></Dialog>}
    {backups_open && <Dialog title="会话删除备份" description="备份默认保留 30 天；只有文件未被新内容修改时才能恢复。" close={() => set_backups_open(false)} busy={delete_busy}><div className="backup-list">{backups.length ? backups.map(item => <div className="backup-row" key={item.id}><div><strong>{new Date(item.createdAt).toLocaleString('zh-CN')}</strong><span>{item.fileCount} 个文件 · {item.deletedTurnCount} 个轮次</span></div><Button variant="secondary" disabled={!item.restorable || delete_busy} onClick={() => void restore_now(item.id)}>{item.restorable ? '恢复' : '已变化'}</Button><Button variant="ghost" disabled={delete_busy} onClick={() => void remove_backup(item.id)}>删除</Button></div>) : <p className="empty-copy">当前会话暂无删除备份。</p>}</div></Dialog>}
    {undo_operation && <div className="session-undo"><span>已删除选中轮次</span><Button variant="secondary" onClick={() => void restore_now(undo_operation)} disabled={delete_busy}>撤销删除</Button><button type="button" aria-label="关闭撤销提示" onClick={() => set_undo_operation(null)}><X size={15} /></button></div>}
  </div>
}
