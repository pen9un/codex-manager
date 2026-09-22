import { basename, normalize } from 'node:path'
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import { write_session_export } from './session_exporter'
import { read_session_metadata } from './session_metadata'
import { session_path_key } from './session_paths'
import { discoverSessionFiles, parseSessionFile, parseSessionIndex, resolveCodexHome, type SessionParseOptions } from './session_parser'
import type { SessionCatalog, SessionCursor, SessionDetail, SessionFileRef, SessionMessageBlock, SessionExportRequest, SessionProjectSummary, SessionRawRecord, SessionSummary } from '../shared/types'

export interface SessionService { list(): Promise<SessionCatalog>; detail(id: string, options?: SessionParseOptions, cursor?: SessionCursor): Promise<SessionDetail>; refresh(): Promise<SessionCatalog>; export_file(request: SessionExportRequest, path: string): Promise<number>; files(id: string): Promise<SessionFileRef[]> }
interface SessionServiceOptions { env?: NodeJS.ProcessEnv; homeDir?: string }

export function sessionProjectId(path?: string): string { return path ? `project:${normalize(path).replaceAll('\\', '/').toLowerCase()}` : 'project:__unassigned__' }
function projectName(path?: string): string { if (!path) return '未归属项目'; const value = path.replace(/[\\/]+$/, ''); return basename(value) || value }

function mergeDetails(details: SessionDetail[]): SessionDetail {
  const first = details[0]
  if (details.length === 1) return first
  const blocks: SessionMessageBlock[] = []; const rawRecords: SessionRawRecord[] = []; let messageCount = 0
  let startedAt = first.summary.startedAt; let updatedAt = first.summary.updatedAt; let fileSize = 0; let malformedLines = 0; let ignoredRecords = 0; let totalLines = 0
  for (const detail of details) {
    const offset = rawRecords.length; rawRecords.push(...detail.rawRecords)
    blocks.push(...detail.blocks.map(block => ({ ...block, rawRecordIndexes: block.rawRecordIndexes.map(index => index + offset) })))
    messageCount += detail.summary.messageCount; fileSize += detail.summary.fileSize; malformedLines += detail.summary.diagnostics.malformedLines; ignoredRecords += detail.summary.diagnostics.ignoredRecords; totalLines += detail.summary.diagnostics.totalLines
    if ((detail.summary.startedAt || '') < (startedAt || '')) startedAt = detail.summary.startedAt
    if ((detail.summary.updatedAt || '') > (updatedAt || '')) updatedAt = detail.summary.updatedAt
  }
  return { summary: { ...first.summary, messageCount, fileSize, fileCount: details.length, startedAt, updatedAt, diagnostics: { malformedLines, ignoredRecords, totalLines } }, blocks, rawRecords }
}

export function createSessionService(options: SessionServiceOptions = {}): SessionService {
  const codex_home = resolveCodexHome(options.env, options.homeDir || homedir())
  const headers = new Map<string, { signature: string; summary: SessionSummary }>()
  let grouped = new Map<string, SessionFileRef[]>()
  let catalog: SessionCatalog | undefined
  let loading: Promise<SessionCatalog> | undefined
  let loaded_at = 0
  const load = async (): Promise<SessionCatalog> => {
    const [refs, titles, metadata] = await Promise.all([discoverSessionFiles(codex_home), parseSessionIndex(codex_home), read_session_metadata(codex_home)])
    // 索引可包含没有位于标准目录中的本地会话。
    const path_key = session_path_key
    const rows_by_path = new Map([...metadata.threads.values()].filter(item => item.path).map(item => [path_key(item.path!), item]))
    const paths = new Set(refs.map(file => path_key(file.path)))
    for (const item of metadata.threads.values()) if (item.path && !paths.has(path_key(item.path))) { refs.push({ id: item.id, path: item.path, archived: item.archived || false }); paths.add(path_key(item.path)) }
    const next_grouped = new Map<string, SessionFileRef[]>()
    const summaries = new Map<string, SessionSummary>()
    const names = new Map<string, string>()
    let cursor = 0
    const worker = async () => {
      while (cursor < refs.length) {
        const file = refs[cursor++]
        try {
          const info = await stat(file.path)
          const signature = `${info.size}:${info.mtimeMs}`
          let head = headers.get(file.path)
          if (!head || head.signature !== signature) {
            const parsed = await parseSessionFile(file, true, { headerOnly: true })
            head = { signature, summary: parsed.summary }; headers.set(file.path, head)
          }
          const row = rows_by_path.get(path_key(file.path)) || metadata.threads.get(head.summary.id)
          const summary: SessionSummary = { ...head.summary, id: row?.id || head.summary.id, diagnostics: { ...head.summary.diagnostics },
            title: row?.title || titles.get(row?.id || head.summary.id) || head.summary.title,
            projectName: row?.projectless ? undefined : row?.projectName,
            preview: head.summary.preview || row?.preview,
            projectPath: row?.projectless ? undefined : row?.projectPath || head.summary.projectPath || row?.cwd,
            startedAt: row?.created || head.summary.startedAt, updatedAt: row?.updated || head.summary.updatedAt,
            archived: row?.archived ?? file.archived,
          }
          const group = next_grouped.get(summary.id) || []; group.push(file); next_grouped.set(summary.id, group)
          const existing = summaries.get(summary.id)
          if (existing) { existing.fileCount = (existing.fileCount || 1) + 1; existing.fileSize += summary.fileSize }
          else summaries.set(summary.id, summary)
          if (row?.projectName && !row.projectless) names.set(sessionProjectId(summary.projectPath), row.projectName)
        } catch { metadata.warnings.push('部分会话文件暂不可读，请刷新重试。') }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    for (const path of headers.keys()) if (!paths.has(path_key(path))) headers.delete(path)
    for (const files of next_grouped.values()) files.sort((a, b) => a.path.localeCompare(b.path))
    grouped = next_grouped
    const projects = new Map<string, SessionProjectSummary>()
    const sessions = [...summaries.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    for (const summary of sessions) {
      const id = sessionProjectId(summary.projectPath)
      summary.projectId = id
      const current = projects.get(id)
      if (current) current.sessionCount++
      else projects.set(id, { id, name: names.get(id) || projectName(summary.projectPath), path: summary.projectPath, sessionCount: 1, updatedAt: summary.updatedAt })
    }
    catalog = { projects: [...projects.values()], sessions, sourcePath: codex_home, warnings: [...new Set(metadata.warnings)] }
    loaded_at = Date.now()
    return catalog
  }
  const ensure_loaded = (refresh = false): Promise<SessionCatalog> => {
    if (loading) return loading
    if (!refresh && catalog && Date.now() - loaded_at < 5000) return Promise.resolve(catalog)
    loading = load().finally(() => { loading = undefined })
    return loading
  }
  return {
    async export_file(request, path) {
      const current = await ensure_loaded()
      const wanted = current.sessions.filter(item => (!request.projectId || item.projectId === request.projectId) && (!request.sessionIds || request.sessionIds.includes(item.id)))
      await write_session_export(path, wanted.map(summary => ({ summary, files: grouped.get(summary.id) || [] })), request.scope, request.selectedBlockIds)
      return wanted.length
    },
    list: () => ensure_loaded(),
    refresh: () => ensure_loaded(true),
    async detail(id, parse_options = { includeRaw: false, maxTextLength: 12_000, maxBlocks: 80 }, cursor) {
      if (!catalog) await ensure_loaded()
      const files = grouped.get(id)
      if (!files?.length) throw new Error('会话不存在')
      const details: SessionDetail[] = []
      if (cursor && (!Number.isSafeInteger(cursor.fileIndex) || cursor.fileIndex < 0 || cursor.fileIndex >= files.length || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isSafeInteger(cursor.line) || cursor.line < 0)) throw new Error('分页位置无效，请重新打开会话')
      let next_cursor: SessionCursor | undefined
      for (let i = cursor?.fileIndex || 0; i < files.length; i++) {
        const detail = await parseSessionFile(files[i], false, { ...parse_options, cursor: i === cursor?.fileIndex ? cursor : undefined })
        details.push(detail)
        if (detail.nextCursor) { next_cursor = { ...detail.nextCursor, fileIndex: i }; break }
        if (parse_options.maxBlocks && details.reduce((total, item) => total + item.blocks.length, 0) >= parse_options.maxBlocks && i + 1 < files.length) { next_cursor = { fileIndex: i + 1, offset: 0, line: 0 }; break }
      }
      const merged = mergeDetails(details)
      merged.nextCursor = next_cursor
      const summary = catalog?.sessions.find(item => item.id === id)
      if (summary) { merged.summary.id = id; merged.summary.title = summary.title; merged.summary.projectPath = summary.projectPath; merged.summary.projectName = summary.projectName; merged.summary.startedAt = summary.startedAt; merged.summary.updatedAt = summary.updatedAt }
      return merged
    },
    async files(id) {
      if (!catalog) await ensure_loaded()
      const files = grouped.get(id)
      if (!files?.length) throw new Error('会话不存在')
      return files.map(file => ({ ...file }))
    },
  }
}
