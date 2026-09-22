import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Plus, Power, Puzzle } from 'lucide-react'
import type { McpServerSummary, OperationResult, SkillSummary } from '../../shared/types'
import { MarkdownView } from './MarkdownView'
import { ActionMenu, Button, Dialog, EmptyState, error_text, Notice, PageHeader, SearchField, StatusBadge, use_confirm, use_leave_guard } from './ui'
import type { NoticeValue, RegisterGuard } from './ui'

type Detail = { kind: 'mcp'; title: string; data: Record<string, unknown> } | { kind: 'skill'; title: string; content: string; files: string[] }
export function ExtensionsPage({ register_guard }: { register_guard: RegisterGuard }): React.JSX.Element {
  const [tab, set_tab] = useState<'mcp' | 'skills'>('mcp')
  const [mcp, set_mcp] = useState<McpServerSummary[]>([])
  const [skills, set_skills] = useState<SkillSummary[]>([])
  const [query, set_query] = useState('')
  const [loading, set_loading] = useState(true)
  const [load_error, set_load_error] = useState('')
  const [notice, set_notice] = useState<NoticeValue | null>(null)
  const [busy, set_busy] = useState(false)
  const [selected, set_selected] = useState<Set<string>>(new Set())
  const [detail, set_detail] = useState<Detail | null>(null)
  const [raw_skill, set_raw_skill] = useState(false)
  const [editor, set_editor] = useState<{ original: string; draft: string } | null>(null)
  const [editor_error, set_editor_error] = useState('')
  const [backups, set_backups] = useState<string[] | null>(null)
  const [diff, set_diff] = useState<{ name: string; current: unknown; backup: unknown } | null>(null)
  const running = useRef(false)
  const dialog_opener = useRef<HTMLElement | null>(null)
  const confirm = use_confirm()
  const api = window.codexExtensions
  const load = async () => {
    try {
      const [mcp_result, skill_result] = await Promise.all([api.mcp(), api.skills()])
      if (!mcp_result.success || !skill_result.success) throw new Error(mcp_result.error || skill_result.error || '扩展读取失败')
      set_mcp(mcp_result.data?.servers || []); set_skills(skill_result.data || []); set_load_error('')
      set_selected(current => new Set([...current].filter(path => skill_result.data?.some(skill => skill.path === path))))
    } catch (error) { const text = error_text(error); set_load_error(text); set_notice({ text, error: true }) }
    finally { set_loading(false) }
  }
  useEffect(() => { void load() }, [])
  const may_leave = async () => !running.current && (!editor || editor.draft === editor.original || await confirm({ title: '放弃未保存的 MCP 配置？', description: '编辑内容尚未写入，继续会放弃这些更改。', action: '放弃更改' }))
  use_leave_guard(register_guard, may_leave)
  const close_editor = async () => { if (await may_leave()) { set_editor(null); set_editor_error('') } }
  const run = async (work: () => Promise<OperationResult<unknown>>, message: string, on_success?: (data: unknown) => void): Promise<boolean> => {
    if (running.current) return false
    if (!editor && !detail && !backups) dialog_opener.current = document.activeElement as HTMLElement
    running.current = true; set_busy(true); set_notice(null)
    try {
      const result = await work()
      if (!result.success) throw new Error(result.error || '操作失败')
      if (result.data === 0) return false
      on_success?.(result.data); if (message) set_notice({ text: message }); await load(); return true
    } catch (error) { const text = error_text(error); set_notice({ text, error: true }); if (editor) set_editor_error(text); return false }
    finally { running.current = false; set_busy(false) }
  }
  const open_mcp = (server: McpServerSummary, edit = false) => void run(() => api.mcpDetail(server.name), '', data => {
    if (edit) { const raw = JSON.stringify({ mcpServers: { [server.name]: data } }, null, 2); set_editor({ original: raw, draft: raw }); set_editor_error(''); set_detail(null) }
    else set_detail({ kind: 'mcp', title: server.name, data: data as Record<string, unknown> })
  })
  const open_skill = (skill: SkillSummary) => void run(() => api.skillDetail(skill.path), '', data => { const result = data as { content: string; files: string[] }; set_raw_skill(false); set_detail({ kind: 'skill', title: skill.name, content: result.content, files: result.files }) })
  const new_mcp = () => { dialog_opener.current = document.activeElement as HTMLElement; set_editor({ original: '{\n  "mcpServers": {}\n}', draft: '{\n  "mcpServers": {}\n}' }); set_editor_error('') }
  const visible_mcp = mcp.filter(server => `${server.name} ${server.command || server.url || ''}`.toLowerCase().includes(query.toLowerCase()))
  const visible_skills = skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()))
  const all_selected = visible_skills.length > 0 && visible_skills.every(skill => selected.has(skill.path))
  return <section className="extensions-page" aria-busy={busy || loading}>
    <PageHeader title="MCP / Skills" description="连接工具，整理能力，让工作流更顺手。" actions={<>{tab === 'mcp' ? <><ActionMenu label="MCP 操作" disabled={busy} items={[{ label: '导入配置文件', action: () => void run(() => api.importMcpFile(), 'MCP 配置已导入') }, { label: '导出 JSON', action: () => void run(() => api.exportMcpJson(), 'MCP 已导出') }, { label: '导出 TOML', action: () => void run(() => api.exportMcpToml(), 'MCP 已导出') }, { label: '备份与回滚', action: () => void run(() => api.mcpBackups(), '', data => { set_backups(data as string[]); set_diff(null) }) }]} /><Button variant="primary" disabled={busy} onClick={new_mcp}><Plus size={16} />新增 MCP</Button></> : <Button variant="primary" disabled={busy} onClick={() => void run(() => api.importSkill(), 'Skill 已导入')}><Plus size={16} />导入本地 Skill</Button>}</>} />
    <div className="toolbar"><div className="section-tabs" role="tablist" aria-label="扩展类型">{(['mcp', 'skills'] as const).map(value => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => { set_tab(value); set_query('') }}>{value === 'mcp' ? 'MCP' : 'Skills'}<span>{value === 'mcp' ? mcp.length : skills.length}</span></button>)}</div><SearchField label="搜索扩展" value={query} on_change={set_query} placeholder={tab === 'mcp' ? '搜索名称、命令或地址' : '搜索 Skill 名称或描述'} /></div>
    {tab === 'skills' && skills.length > 0 && <div className="selection-bar"><label className="check-label"><input type="checkbox" aria-label="全选可见 Skills" checked={all_selected} disabled={busy || !visible_skills.length} onChange={() => set_selected(current => { const next = new Set(current); visible_skills.forEach(skill => all_selected ? next.delete(skill.path) : next.add(skill.path)); return next })} />{selected.size ? `已选择 ${selected.size} 个` : '全选'}</label>{selected.size > 0 && <Button disabled={busy} onClick={() => void run(() => api.exportSkills([...selected]), 'Skill 目录已导出')}><Download size={14} />导出选中</Button>}<span className="selection-count">导入与导出不会执行脚本</span></div>}
    {loading ? <EmptyState loading title="正在读取扩展" /> : load_error ? <EmptyState title="扩展读取失败" description={load_error} action={<Button onClick={() => void load()}>重新加载</Button>} /> : (tab === 'mcp' ? visible_mcp.length : visible_skills.length) === 0 ? <EmptyState title={query ? '没有匹配的扩展' : tab === 'mcp' ? '连接你的第一个工具' : '添加你的第一项技能'} description={query ? '调整搜索词后再试。' : tab === 'mcp' ? '添加 MCP 配置，将常用工具接入工作流。' : '导入本地 Skill 文件夹或 ZIP。'} action={<Button onClick={() => query ? set_query('') : tab === 'mcp' ? new_mcp() : void run(() => api.importSkill(), 'Skill 已导入')}>{query ? '清除搜索' : tab === 'mcp' ? '新增 MCP' : '导入本地 Skill'}</Button>} /> : <div className="extension-list panel">{tab === 'mcp' ? visible_mcp.map(server => <article className="extension-row" key={server.name}><div className="extension-icon"><Puzzle size={19} /></div><button type="button" className="extension-main interactive-row" disabled={busy} onClick={() => open_mcp(server)}><b>{server.name}</b><span>{server.command || server.url} · {server.transport === 'stdio' ? 'STDIO' : 'HTTP'}</span><small>{server.approvalMode ? `审批：${server.approvalMode}` : '默认审批'} · {server.toolTimeoutSec ? `${server.toolTimeoutSec} 秒超时` : '默认超时'}</small></button><StatusBadge tone={server.enabled ? 'success' : 'neutral'}>{server.enabled ? '已启用' : '已停用'}</StatusBadge><Button variant="ghost" disabled={busy} onClick={() => void run(() => api.setMcpEnabled(server.name, !server.enabled), server.enabled ? 'MCP 已停用' : 'MCP 已启用')}><Power size={15} />{server.enabled ? '停用' : '启用'}</Button><ActionMenu label={`${server.name} 更多操作`} icon_only disabled={busy} items={[{ label: '编辑配置', action: () => open_mcp(server, true) }, { label: '删除 MCP', danger: true, action: () => { void confirm({ title: `删除 ${server.name}？`, description: '将移除此 MCP 配置，写入前会自动备份。', action: '删除 MCP', danger: true }).then(ok => { if (ok) void run(() => api.removeMcp(server.name), 'MCP 已删除') }) } }]} /></article>) : visible_skills.map(skill => <article className="extension-row" key={skill.id}><input type="checkbox" disabled={busy} aria-label={`选择 ${skill.name}`} checked={selected.has(skill.path)} onChange={() => set_selected(current => { const next = new Set(current); next.has(skill.path) ? next.delete(skill.path) : next.add(skill.path); return next })} /><div className="extension-icon"><FileText size={19} /></div><button type="button" className="extension-main interactive-row" disabled={busy || !skill.valid} onClick={() => open_skill(skill)}><b>{skill.name}</b><span>{skill.description}</span><small>{skill.scope === 'project' ? '项目级' : '用户级'}</small></button><StatusBadge tone={!skill.valid ? 'danger' : skill.enabled ? 'success' : 'neutral'}>{!skill.valid ? '格式无效' : skill.enabled ? '已启用' : '已停用'}</StatusBadge><Button variant="ghost" disabled={busy || !skill.valid} onClick={() => void run(() => api.setSkillEnabled(skill.path, !skill.enabled), skill.enabled ? 'Skill 已停用' : 'Skill 已启用')}><Power size={15} />{skill.enabled ? '停用' : '启用'}</Button></article>)}</div>}
    <Notice value={notice} clear={() => set_notice(null)} />
    {editor && <Dialog return_focus={dialog_opener.current} title="编辑 MCP JSON" description="保存会合并现有配置并自动备份；脱敏占位符会保留原凭据。" busy={busy} close={() => void close_editor()} className="mcp-editor" actions={<><Button disabled={busy} onClick={() => void close_editor()}>取消</Button><Button variant="primary" disabled={busy || !editor.draft.trim()} onClick={() => { set_editor_error(''); void run(() => api.importMcpJson(editor.draft), 'MCP 配置已保存', () => set_editor(null)) }}>{busy ? '保存中…' : '保存配置'}</Button></>}><textarea className="code-editor" aria-label="MCP JSON 编辑器" value={editor.draft} disabled={busy} spellCheck={false} onChange={event => set_editor({ ...editor, draft: event.target.value })} aria-invalid={!!editor_error} />{editor_error && <p role="alert" className="field-error">{editor_error}</p>}</Dialog>}
    {backups && <Dialog return_focus={dialog_opener.current} title="备份与回滚" description="回滚仅恢复 MCP 配置，保留当前其他设置。" close={() => { if (!busy) set_backups(null) }} busy={busy} className="backup-panel">{backups.length === 0 ? <p className="inline-empty">暂无备份</p> : <div className="backup-list">{backups.map(name => <div key={name}><code>{name}</code><div><Button disabled={busy} onClick={() => void run(() => api.mcpDiff(name), '', data => set_diff({ name, ...(data as { current: unknown; backup: unknown }) }))}>查看 Diff</Button><Button disabled={busy} onClick={() => { void confirm({ title: '恢复此备份中的 MCP？', description: '当前 MCP 配置将被替换。其他配置会保留，回滚前将再次备份。', action: '回滚 MCP', danger: true }).then(ok => { if (ok) void run(() => api.rollbackMcp(name), 'MCP 已回滚', () => set_backups(null)) }) }}>回滚</Button></div></div>)}</div>}{diff && <div className="backup-diff"><h3>脱敏配置比较</h3><p className="field-hint">展示整份配置，仅 MCP 部分参与回滚。</p><h4>当前配置</h4><pre>{JSON.stringify(diff.current, null, 2)}</pre><h4>所选备份</h4><pre>{JSON.stringify(diff.backup, null, 2)}</pre></div>}</Dialog>}
    {detail && <Dialog busy={busy} return_focus={dialog_opener.current} title={detail.title} description={detail.kind === 'mcp' ? 'MCP 配置 · 敏感信息已脱敏' : 'Skill 文档 · 只读预览'} close={() => set_detail(null)} className="extension-detail">{detail.kind === 'mcp' ? <><dl className="detail-facts">{[['传输方式', detail.data.url ? 'HTTP' : 'STDIO'], ['命令 / 地址', detail.data.url || detail.data.command || '未配置'], ['审批模式', detail.data.default_tools_approval_mode || '默认'], ['启动超时', detail.data.startup_timeout_sec || '默认'], ['调用超时', detail.data.tool_timeout_sec || '默认']].map(([name, value]) => <div key={String(name)}><dt>{String(name)}</dt><dd>{String(value)}</dd></div>)}</dl><h3>工具白名单</h3><pre>{JSON.stringify(detail.data.enabled_tools || [], null, 2)}</pre><h3>工具黑名单</h3><pre>{JSON.stringify(detail.data.disabled_tools || [], null, 2)}</pre><h3>脱敏环境变量与请求头</h3><pre>{JSON.stringify({ env: detail.data.env || {}, headers: detail.data.http_headers || detail.data.headers || {} }, null, 2)}</pre></> : <><details className="skill-files"><summary>目录文件 · {detail.files.length}</summary><div>{detail.files.map(file => <code key={file}>{file}</code>)}</div></details><div className="segmented skill-document-tabs"><button aria-pressed={!raw_skill} onClick={() => set_raw_skill(false)}>阅读文档</button><button aria-pressed={raw_skill} onClick={() => set_raw_skill(true)}>原始 SKILL.md</button></div>{raw_skill ? <pre>{detail.content}</pre> : <MarkdownView source={detail.content} />}</>}</Dialog>}
  </section>
}
