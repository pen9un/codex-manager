import { useEffect, useRef, useState } from 'react'
import { ArchiveRestore, Copy, FileText, Folder, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MEMORY_CATEGORIES, MEMORY_EDIT_LIMIT } from '../../shared/memory_types'
import type { MemoryBackup, MemoryBackupDocument, MemoryCatalog, MemoryDocument, MemoryEntry } from '../../shared/memory_types'
import type { OperationResult } from '../../shared/types'
import { MemoryDivider } from './memory_divider'
import { Button, Dialog, EmptyState, PageHeader, SearchField, error_text, use_confirm, use_leave_guard } from './ui'
import type { NoticeValue, RegisterGuard } from './ui'
import './memory_styles.css'

type Category = keyof typeof MEMORY_CATEGORIES
const category_keys = Object.keys(MEMORY_CATEGORIES) as Category[]
const backup_status = { prepared: '已准备', completed: '已完成', failed: '失败', uncertain: '需核验', restored: '已恢复' }
function result_data<T>(result: OperationResult<T>, fallback: string): T {
  if (!result.success || result.data === undefined) throw new Error(result.error || fallback)
  return result.data
}
function date_text(value: string): string { return new Date(value).toLocaleString('zh-CN') }
function byte_count(value: string): number { return new TextEncoder().encode(value).byteLength }
function size_text(value: number): string { return value < 1024 ? `${value} 字节` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(2)} MiB` }
function MemoryMarkdown({ content }: { content: string }): React.JSX.Element {
  // 记忆正文仅作为数据展示，不执行其中的指令，也不自动加载图片资源。
  return <article className="markdown-preview memory-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span className="memory-image-placeholder">[图片：{alt || '未提供说明'}]</span>,
    a: ({ href, children }) => /^https:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
  }}>{content}</Markdown></article>
}

export function MemoriesPage({ register_guard }: { register_guard: RegisterGuard }): React.JSX.Element {
  const [catalog, set_catalog] = useState<MemoryCatalog | null>(null)
  const [list_loading, set_list_loading] = useState(true)
  const [list_error, set_list_error] = useState('')
  const [category, set_category] = useState<Category>('all')
  const [query, set_query] = useState('')
  const [search_files, set_search_files] = useState<MemoryEntry[]>([])
  const [search_loading, set_search_loading] = useState(false)
  const [search_error, set_search_error] = useState('')
  const [search_warnings, set_search_warnings] = useState<string[]>([])
  const [selected_id, set_selected_id] = useState<string | null>(null)
  const [document, set_document] = useState<MemoryDocument | null>(null)
  const [detail_loading, set_detail_loading] = useState(false)
  const [detail_error, set_detail_error] = useState('')
  const [page_offsets, set_page_offsets] = useState<number[]>([0])
  const [mode, set_mode] = useState<'read' | 'raw' | 'edit'>('read')
  const [draft, set_draft] = useState('')
  const [creating, set_creating] = useState(false)
  const [title, set_title] = useState('')
  const [busy, set_busy] = useState(false)
  const [notice, set_notice] = useState<NoticeValue | null>(null)
  const [backups_open, set_backups_open] = useState(false)
  const [backups, set_backups] = useState<MemoryBackup[]>([])
  const [backups_error, set_backups_error] = useState('')
  const [backup_document, set_backup_document] = useState<MemoryBackupDocument | null>(null)
  const [backup_offsets, set_backup_offsets] = useState<number[]>([0])
  const [backup_read_error, set_backup_read_error] = useState('')
  const running = useRef(false)
  const read_sequence = useRef(0)
  const search_sequence = useRef(0)
  const alive = useRef(true)
  const body_ref = useRef<HTMLDivElement>(null)
  const confirm = use_confirm()
  const dirty = creating ? Boolean(title || draft) : Boolean(document && draft !== document.content)
  const too_large = byte_count(draft) > MEMORY_EDIT_LIMIT
  const selected = catalog?.files.find(file => file.id === selected_id)
  const visible_files = query.trim() ? search_files : (catalog?.files || []).filter(file => category === 'all' || file.category === category)
  const discard = () => confirm({ title: '放弃未保存的记忆草稿？', description: '当前草稿尚未写入本地文件。继续会放弃这些更改。', action: '放弃更改' })
  use_leave_guard(register_guard, async () => {
    if (running.current) return false
    if (!dirty) return true
    running.current = true
    try { return await discard() } finally { running.current = false }
  })
  useEffect(() => {
    // 原生窗口关闭和托盘退出不经过页面导航，需要单独保护草稿及未完成操作。
    const on_before_unload = (event: BeforeUnloadEvent) => {
      if (!dirty && !running.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', on_before_unload)
    return () => window.removeEventListener('beforeunload', on_before_unload)
  }, [dirty])
  const run = async (work: () => Promise<void>, protect = false) => {
    if (running.current) return
    running.current = true; set_busy(true)
    try {
      if (protect && dirty && !await discard()) return
      set_notice(null); await work()
    } catch (error) { if (alive.current) set_notice({ text: error_text(error), error: true }) }
    finally { running.current = false; if (alive.current) set_busy(false) }
  }
  const clear_detail = () => {
    read_sequence.current++; set_selected_id(null); set_document(null); set_draft(''); set_title(''); set_creating(false)
    set_detail_loading(false); set_detail_error(''); set_mode('read'); set_page_offsets([0])
  }
  const read_document = async (id: string, offsets = [0], version?: string, entry = catalog?.files.find(file => file.id === id), preserve_on_error = false) => {
    const sequence = ++read_sequence.current
    if (entry && !entry.readable) {
      set_selected_id(id); set_document(null); set_draft(''); set_title(''); set_creating(false); set_detail_error(entry.read_error || '此文件仅展示元数据，不支持正文读取。'); set_mode('read'); return
    }
    if (!preserve_on_error) { set_selected_id(id); set_detail_loading(true); set_detail_error('') }
    try {
      const next = result_data(await window.codexMemories.read(id, offsets[offsets.length - 1], version), '记忆正文读取失败')
      if (!alive.current || sequence !== read_sequence.current) return
      if (version && next.version !== version) throw new Error('文件版本已变化，请刷新后从第一页重新阅读。')
      set_selected_id(id); set_document(next); set_draft(next.content); set_page_offsets(offsets); set_creating(false); set_title(''); set_mode('read'); set_detail_error('')
      body_ref.current?.scrollTo(0, 0)
    } catch (error) {
      if (alive.current && sequence === read_sequence.current) {
        if (preserve_on_error) throw error
        set_detail_error(error_text(error)); set_document(null)
      }
    } finally { if (alive.current && sequence === read_sequence.current) set_detail_loading(false) }
  }
  const load_catalog = async (refresh: boolean): Promise<MemoryCatalog> => {
    set_list_loading(true); set_list_error('')
    try {
      const next = result_data(await (refresh ? window.codexMemories.refresh() : window.codexMemories.list()), '记忆列表读取失败')
      if (alive.current) set_catalog(next)
      return next
    } catch (error) { if (alive.current) set_list_error(error_text(error)); throw error }
    finally { if (alive.current) set_list_loading(false) }
  }
  const reload = async (preferred_id: string | null = selected_id) => {
    const next = await load_catalog(true)
    const target = next.files.find(file => file.id === preferred_id) || next.files.find(file => file.category === 'summary')
    if (target) {
      await read_document(target.id, [0], undefined, target, true)
      if (category !== 'all' && target.category !== category) set_category('all')
    } else clear_detail()
  }
  useEffect(() => {
    alive.current = true
    void run(async () => {
      const next = await load_catalog(false)
      const summary = next.files.find(file => file.category === 'summary')
      if (alive.current && summary) await read_document(summary.id, [0], undefined, summary)
    })
    return () => { alive.current = false; read_sequence.current++; search_sequence.current++ }
  }, [])
  useEffect(() => {
    const sequence = ++search_sequence.current
    set_search_error(''); set_search_warnings([]); set_search_files([])
    if (!query.trim()) { set_search_loading(false); return }
    set_search_loading(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = result_data(await window.codexMemories.search(query, category), '记忆搜索失败')
        if (alive.current && sequence === search_sequence.current) { set_search_files(result.files); set_search_warnings(result.warnings) }
      } catch (error) { if (alive.current && sequence === search_sequence.current) set_search_error(error_text(error)) }
      finally { if (alive.current && sequence === search_sequence.current) set_search_loading(false) }
    }, 250)
    return () => { window.clearTimeout(timer); search_sequence.current++ }
  }, [query, category, catalog])
  const select_file = (id: string) => {
    if (selected_id === id && !creating) return
    void run(async () => { clear_detail(); await read_document(id) }, true)
  }
  const change_category = (next: Category) => {
    if (next === category) return
    const changes_selection = creating || (selected && next !== 'all' && selected.category !== next)
    void run(async () => { set_category(next); if (changes_selection) clear_detail() }, Boolean(changes_selection))
  }
  const save = () => void run(async () => {
    if (too_large || (!creating && (!document?.editable || !dirty))) return
    if (creating && !title.trim()) throw new Error('请填写记忆标题。')
    if (creating && !draft.trim()) throw new Error('请填写记忆正文。')
    const result = creating
      ? await window.codexMemories.create({ title: title.trim(), content: draft })
      : await window.codexMemories.save({ id: document!.file.id, expected_version: document!.version, content: draft })
    const saved = result_data(result, '记忆保存失败')
    // 写入已完成后单独刷新；刷新失败时保留草稿，避免误报写入失败。
    try { await reload(saved.id) }
    catch (error) { set_notice({ text: `文件已写入，列表刷新失败：${error_text(error)}。草稿已保留，请刷新核验。`, error: true }); return }
    set_notice({ text: creating ? '已保存人工补充，待 Codex 后续整合。' : '已保存本地记忆；自动生成的文件可能在后续整合时重建。' })
  })
  const save_ref = useRef(save)
  save_ref.current = save
  useEffect(() => {
    const on_key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!backups_open && (creating || mode === 'edit')) save_ref.current()
      }
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [mode, creating, backups_open])
  const remove = () => void run(async () => {
    if (!document) return
    if (!await confirm({ title: '删除这份记忆文件？', description: `路径：${catalog?.root}/${document.file.relative_path}。删除会影响后续记忆读取，已加载的上下文不会同步清除。删除前将创建备份。`, action: '删除记忆文件', danger: true })) return
    const result = await window.codexMemories.remove({ id: document.file.id, expected_version: document.version })
    if (!result.success) throw new Error(result.error || '记忆删除失败')
    clear_detail(); await reload(null); set_notice({ text: '记忆文件已删除，可在备份中恢复。' })
  }, true)
  const load_backups = async () => {
    set_backups_error('')
    try { set_backups(result_data(await window.codexMemories.list_backups(), '备份列表读取失败')) }
    catch (error) { set_backups_error(error_text(error)) }
  }
  const read_backup = async (id: string, offsets = [0]) => {
    set_backup_read_error('')
    try {
      const next = result_data(await window.codexMemories.read_backup(id, offsets[offsets.length - 1]), '备份正文读取失败')
      set_backup_document(next); set_backup_offsets(offsets)
    } catch (error) { set_backup_document(null); set_backup_read_error(error_text(error)) }
  }
  const restore_backup = (item: MemoryBackup) => void run(async () => {
    if (!item.restorable) return
    if (!await confirm({ title: '恢复这份记忆备份？', description: `目标：${catalog?.root}/${item.relative_path}。将恢复操作前的文件；如果目标已变化，恢复会被拒绝。`, action: '恢复备份' })) return
    const restored = result_data(await window.codexMemories.restore(item.id), '备份恢复失败')
    set_backup_document(null); await load_backups(); await reload(restored.id); set_notice({ text: '记忆备份已恢复。' })
  }, true)
  const remove_backup = (item: MemoryBackup) => void run(async () => {
    if (!await confirm({ title: '永久删除这份备份？', description: `文件：${item.relative_path}；备份时间：${date_text(item.created_at)}。仅删除此备份，不修改当前记忆；删除后无法通过该备份恢复。`, action: '删除备份', danger: true })) return
    const result = await window.codexMemories.remove_backup(item.id)
    if (!result.success) throw new Error(result.error || '备份删除失败')
    if (backup_document?.backup.id === item.id) set_backup_document(null)
    await load_backups(); set_notice({ text: '备份已删除。' })
  })
  const count_category = (key: Category) => (catalog?.files || []).filter(file => key === 'all' || file.category === key).length

  return <section className="memories-page" aria-busy={busy}>
    <PageHeader title="记忆管理" description="浏览和维护 Codex 本地记忆，修改前自动备份。" actions={<>
      <Button disabled={busy} onClick={() => void run(() => reload(), true)}><RefreshCw size={16} />刷新</Button>
      <Button disabled={busy} onClick={() => void run(async () => { set_backups_open(true); await load_backups() })}><ArchiveRestore size={16} />备份</Button>
      <Button variant="primary" disabled={busy || !catalog} onClick={() => void run(async () => { clear_detail(); set_creating(true); set_mode('edit') }, true)}><Plus size={16} />新增记忆</Button>
    </>} />
    <div className="memory-location"><Folder size={15} /><span title={catalog?.root}>{catalog?.root || '正在探测记忆目录…'}</span>{catalog && !catalog.exists && <b>目录尚未创建</b>}</div>
    <details className="memory-config"><summary>记忆配置状态（只读）</summary><p>以下仅为配置文件中的值，不代表当前运行状态；本页不会修改这些配置。</p>
      {catalog?.config.error && <p role="alert">{catalog.config.error}</p>}
      <dl>{catalog?.config.values.map(item => <div key={item.key}><dt>{item.key}</dt><dd>{item.value === null ? '未显式配置' : item.value ? '已配置为启用' : '已配置为关闭'}</dd></div>)}</dl>
    </details>
    {notice && !backups_open && <div className={`memory-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button type="button" aria-label="关闭记忆提示" onClick={() => set_notice(null)}>关闭</button></div>}
    {catalog?.warnings.length ? <details className="memory-warnings"><summary>读取提示（{catalog.warnings.length}）</summary>{catalog.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
    {list_error && <div className="memory-notice error" role="alert"><span>记忆列表读取失败：{list_error}。已加载内容和草稿保留。</span><Button disabled={busy} onClick={() => void run(() => reload(), true)}>重试读取列表</Button></div>}
    {!catalog ? <EmptyState loading={list_loading} title={list_error ? '记忆列表读取失败' : '正在读取记忆目录'} /> : <div className="memory-workbench">
      <aside className="memory-categories" aria-label="记忆分类" tabIndex={0}><div className="memory-pane-head"><h2>分类</h2><span>{catalog.files.length}</span></div>{category_keys.map(key => <button type="button" key={key} className={category === key ? 'active' : ''} aria-pressed={category === key} disabled={busy} onClick={() => change_category(key)}><span>{MEMORY_CATEGORIES[key]}</span><b>{count_category(key)}</b></button>)}</aside>
      <MemoryDivider index={0} />
      <section className="memory-list" aria-label="记忆文件列表"><div className="memory-pane-head"><h2>{MEMORY_CATEGORIES[category]}</h2><span>{query.trim() && search_loading ? '…' : visible_files.length}</span></div>
        <label className="memory-mobile-category"><span>记忆分类</span><select aria-label="记忆分类选择" value={category} disabled={busy} onChange={event => change_category(event.target.value as Category)}>{category_keys.map(key => <option key={key} value={key}>{MEMORY_CATEGORIES[key]}（{count_category(key)}）</option>)}</select></label>
        <SearchField label="搜索记忆" value={query} on_change={set_query} placeholder="搜索标题、路径或正文" />
        <div className="memory-file-scroll" tabIndex={0} aria-label="可滚动记忆列表">
          {search_loading ? <EmptyState loading title="正在搜索记忆正文" /> : search_error ? <EmptyState title="记忆搜索失败" description={search_error} action={<Button onClick={() => set_catalog(current => current ? { ...current } : current)}>重试搜索</Button>} /> : visible_files.length ? visible_files.map(file => <button type="button" className={`memory-file ${selected_id === file.id && !creating ? 'active' : ''}`} key={file.id} data-memory-path={file.relative_path} aria-pressed={selected_id === file.id && !creating} disabled={busy} onClick={() => select_file(file.id)}>
            <strong><FileText size={15} />{file.title}</strong><span className="memory-file-excerpt">{file.excerpt || (file.readable ? '暂无正文摘要' : file.read_error || '文件暂不可读取')}</span><span className="memory-file-path" title={file.relative_path}>{file.relative_path}</span><small>{MEMORY_CATEGORIES[file.category]} · {date_text(file.modified_at)}</small>
          </button>) : <EmptyState title={query.trim() ? '没有匹配的记忆' : '此分类暂无记忆'} description={query.trim() ? '尝试其他关键词，或清除搜索查看文件。' : '可通过“新增记忆”添加人工补充。'} />}
          {search_warnings.map((warning, index) => <p className="memory-search-warning" key={index}>{warning}</p>)}
        </div>
      </section>
      <MemoryDivider index={1} />
      <section className="memory-detail" aria-label="记忆正文">
        {detail_loading ? <EmptyState loading title="正在读取记忆正文" /> : detail_error ? <div className="memory-unreadable"><h2>{selected?.title || '记忆正文读取失败'}</h2>{selected && <><code>{catalog.root}/{selected.relative_path}</code><dl className="memory-metadata"><div><dt>文件大小</dt><dd>{size_text(selected.size)}</dd></div><div><dt>修改时间</dt><dd>{date_text(selected.modified_at)}</dd></div><div><dt>分类</dt><dd>{MEMORY_CATEGORIES[selected.category]}</dd></div></dl></>}<p role="alert">{detail_error}</p><p>当前仅展示文件信息，不能编辑或删除。</p>{selected?.readable && <Button disabled={busy} onClick={() => selected_id && void run(() => read_document(selected_id))}>从第一页重新读取</Button>}</div> : !document && !creating ? <EmptyState title="选择一份记忆" description="默认展示记忆摘要；从左侧列表选择其他文件阅读。" /> : <>
          <div className="memory-detail-head"><div><h2>{creating ? '新增人工补充' : document!.file.title}</h2><p>{creating ? '保存到人工补充目录，待 Codex 后续整合。' : `${MEMORY_CATEGORIES[document!.file.category]} · ${size_text(document!.file.size)} · ${date_text(document!.file.modified_at)}`}</p></div><div className="memory-detail-actions">{mode === 'edit' ? <><Button disabled={busy} onClick={() => void run(async () => { if (creating) clear_detail(); else { set_draft(document!.content); set_mode('read') } }, true)}>取消编辑</Button><Button variant="primary" disabled={busy || too_large || (creating ? !title.trim() || !draft.trim() : !dirty)} onClick={save}><Save size={15} />保存</Button></> : <Button variant="danger" disabled={busy} onClick={remove}><Trash2 size={15} />删除</Button>}</div></div>
          {!creating && <div className="memory-path"><code>{catalog.root}/{document!.file.relative_path}</code><Button variant="ghost" className="icon-button" aria-label="复制记忆路径" onClick={() => void run(async () => { await navigator.clipboard.writeText(`${catalog.root}/${document!.file.relative_path}`); set_notice({ text: '记忆路径已复制。' }) })}><Copy size={15} /></Button></div>}
          <div className="memory-toolbar"><div className="segmented" aria-label="记忆显示方式"><button type="button" aria-pressed={mode === 'read'} disabled={busy || creating} onClick={() => set_mode('read')}>阅读</button><button type="button" aria-pressed={mode === 'raw'} disabled={busy || creating} onClick={() => set_mode('raw')}>原文</button><button type="button" aria-pressed={mode === 'edit'} disabled={busy || (!creating && !document?.editable)} title={!document?.editable && !creating ? '大文件采用分段只读模式' : '编辑本地文件'} onClick={() => set_mode('edit')}>编辑</button></div><span>{dirty ? '有未保存更改' : document?.editable || creating ? '最多 2 MiB' : '分段只读'}</span></div>
          {(document?.warning || (mode === 'edit' && !creating && document?.file.category !== 'notes')) && <p className="memory-warning">{document?.warning || '这是自动生成的记忆文件，手动修改可能在后续整合时被重建。'}</p>}
          {creating && <label className="memory-title-field">标题<input aria-label="新记忆标题" value={title} maxLength={200} disabled={busy} onChange={event => set_title(event.target.value)} placeholder="为这份人工补充命名" /></label>}
          {too_large && <p className="memory-warning" role="alert">内容超过 2 MiB，暂时无法保存。请缩减后重试，草稿仍保留。</p>}
          <div className="memory-body" ref={body_ref} tabIndex={mode === 'edit' ? -1 : 0} aria-label="可滚动记忆正文">{mode === 'edit' ? <textarea aria-label="记忆编辑器" value={draft} disabled={busy} spellCheck={false} onChange={event => set_draft(event.target.value)} /> : mode === 'raw' ? <pre className="memory-raw">{draft}</pre> : <MemoryMarkdown content={draft} />}</div>
          {document && (document.next_offset !== undefined || page_offsets.length > 1) && <div className="memory-pagination"><Button disabled={busy || page_offsets.length <= 1} onClick={() => void run(() => read_document(document.file.id, page_offsets.slice(0, -1), document.version))}>上一段</Button><span>第 {page_offsets.length} 段 · 分段只读</span><Button disabled={busy || document.next_offset === undefined} onClick={() => void run(() => read_document(document.file.id, [...page_offsets, document.next_offset!], document.version))}>下一段</Button></div>}
          <footer className="memory-footer"><span>{draft.length.toLocaleString()} 字符{document && !document.editable ? '（当前段）' : ''}</span><span>{mode === 'edit' ? '编辑中 · Ctrl+S 保存' : '只读浏览'}</span></footer>
        </>}
      </section>
    </div>}
    {backups_open && <Dialog title="记忆备份" description="保存和删除前生成的备份。只有目标未发生冲突时才能恢复。" className="memory-backup-dialog" busy={busy} close={() => { set_backups_open(false); set_backup_document(null); set_backup_read_error('') }}>
      {notice && <div className={`memory-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      {backups_error ? <EmptyState title="备份列表读取失败" description={backups_error} action={<Button disabled={busy} onClick={() => void run(load_backups)}>重试读取备份</Button>} /> : <div className="memory-backup-list">{backups.length ? backups.map(item => <div className="memory-backup-row" key={item.id} data-backup-id={item.id}><div><strong>{item.relative_path}</strong><span>{item.kind === 'save' ? '保存前备份' : '删除前备份'} · {date_text(item.created_at)} · {backup_status[item.status]}</span>{item.error && <p>{item.error}</p>}</div><div className="memory-backup-actions"><Button disabled={busy} onClick={() => void run(() => read_backup(item.id))}>查看</Button><Button disabled={busy || !item.restorable} title={!item.restorable ? '当前状态不允许恢复' : undefined} onClick={() => restore_backup(item)}>恢复</Button><Button variant="ghost" disabled={busy} onClick={() => remove_backup(item)}>删除备份</Button></div></div>) : <p className="memory-backup-empty">暂无备份。修改或删除记忆前会自动创建备份。</p>}</div>}
      {backup_read_error && <p role="alert" className="memory-warning">{backup_read_error}</p>}
      {backup_document && <section className="memory-backup-preview" aria-label="备份正文"><h3>{backup_document.backup.relative_path}</h3><pre tabIndex={0}>{backup_document.content}</pre><div className="memory-pagination"><Button disabled={busy || backup_offsets.length <= 1} onClick={() => void run(() => read_backup(backup_document.backup.id, backup_offsets.slice(0, -1)))}>备份上一段</Button><span>第 {backup_offsets.length} 段 · 只读</span><Button disabled={busy || backup_document.next_offset === undefined} onClick={() => void run(() => read_backup(backup_document.backup.id, [...backup_offsets, backup_document.next_offset!]))}>备份下一段</Button></div></section>}
    </Dialog>}
  </section>
}
