import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { read_session_lines } from './session_lines'
import type { SessionCursor, SessionDetail, SessionFileRef, SessionMessageBlock, SessionRawRecord, SessionSummary, SessionToolBlock } from '../shared/types'

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env, homeDir = homedir()): string {
  return env.CODEX_HOME?.trim() || join(homeDir, '.codex')
}

export async function discoverSessionFiles(codexHome: string): Promise<SessionFileRef[]> {
  const files: SessionFileRef[] = []
  async function walk(folder: string, archived: boolean): Promise<void> {
    let entries
    try { entries = await readdir(folder, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) await walk(path, archived)
      else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) files.push({ id: entry.name.slice(8, -6), path, archived })
    }
  }
  await walk(join(codexHome, 'sessions'), false)
  await walk(join(codexHome, 'archived_sessions'), true)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function parseSessionIndex(codexHome: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  try {
    for (const line of (await readFile(join(codexHome, 'session_index.jsonl'), 'utf8')).split(/\r?\n/)) {
      try { const row = JSON.parse(line); if (typeof row.id === 'string' && typeof row.thread_name === 'string' && row.thread_name.trim()) titles.set(row.id, row.thread_name.trim()) } catch { /* 索引缺行不影响正文解析。 */ }
    }
  } catch { /* 旧版本可能没有标题索引。 */ }
  return titles
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(item => { if (!item || typeof item !== 'object') return ''; if (typeof item.text === 'string') return item.text; if (/image/.test(String(item.type || ''))) return '［图片附件］'; if (/audio/.test(String(item.type || ''))) return '［音频附件］'; return '' }).filter(Boolean).join('\n')
}
export function clean_user_text(text: string): string {
  let remaining = text.trim()
  // 只剥离已知的注入前缀，不删除用户正文中引用的 XML 或代码。
  const prefix = /^(?:# AGENTS\.md instructions[^\r\n]*\r?\n\s*)?<((?:recommended_plugins|environment_context|permissions instructions|skills_instructions|INSTRUCTIONS|turn_aborted|subagent_notification|collaboration_mode|app-context))\b[^>]*>[\s\S]*?<\/\1>\s*/i
  while (prefix.test(remaining)) remaining = remaining.replace(prefix, '').trimStart()
  return remaining
}
function printable(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value ?? '') }
function previewText(value: string, maxLength?: number): string {
  if (!maxLength || value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n\n［内容过长，详情预览已截断；导出时保留原文］`
}

export interface SessionParseOptions { includeRaw?: boolean; maxTextLength?: number; headerOnly?: boolean; includeTools?: boolean; maxBlocks?: number; cursor?: SessionCursor
  on_message?: (block: SessionMessageBlock, continuation: boolean) => Promise<void>
  on_tool?: (block: SessionMessageBlock, tool: SessionToolBlock, is_result: boolean) => Promise<void>
  on_raw?: (record: SessionRawRecord) => Promise<void>
}
export async function parseSessionFile(file: SessionFileRef, summaryOnly = false, options: SessionParseOptions = {}): Promise<SessionDetail> {
  const includeRaw = options.includeRaw ?? !summaryOnly
  const maxTextLength = options.maxTextLength
  const fileStat = await stat(file.path)
  const prefix = createHash('sha256').update(file.path).digest('hex').slice(0, 16)
  const summary: SessionSummary = { id: file.id, title: file.id, filePath: file.path, archived: file.archived, fileSize: fileStat.size, messageCount: 0, diagnostics: { malformedLines: 0, ignoredRecords: 0, totalLines: 0 } }
  const blocks: SessionMessageBlock[] = []; const rawRecords: SessionRawRecord[] = []
  let firstUser = ''; let turnId: string | undefined; let explicitTurn: string | undefined = options.cursor?.turnId; let assistant: SessionMessageBlock | undefined
  let previous: { role: string; text: string; source: string; turn?: string } | undefined
  const calls = new Map<string, { tool: SessionToolBlock; owner: SessionMessageBlock }>(); const pendingIndexes: number[] = []; let currentRaw: SessionRawRecord | undefined
  const newBlock = async (role: 'user' | 'assistant', text: string, index: number, timestamp?: string): Promise<SessionMessageBlock> => {
    if (role === 'user') { turnId = explicitTurn || `${prefix}-turn-${summary.diagnostics.totalLines}`; assistant = undefined; for (const i of pendingIndexes.splice(0)) if (rawRecords[i]) rawRecords[i].turnId = turnId }
    if (!turnId) turnId = explicitTurn || `${prefix}-turn-${summary.diagnostics.totalLines}`
    if (currentRaw) currentRaw.turnId = turnId
    const block: SessionMessageBlock = { id: `${prefix}-block-${summary.diagnostics.totalLines}`, turnId, role, text, timestamp, tools: [], rawRecordIndexes: includeRaw ? [index] : [] }
    summary.messageCount++; if (!summaryOnly && !options.on_message) blocks.push(block); if (options.on_message) { await options.on_message(block, false); block.text = text ? '…' : '' }; return block
  }
  let nextCursor: SessionCursor | undefined
  summary.diagnostics.totalLines = options.cursor?.line || 0
  for await (const record of read_session_lines(file.path, options.cursor?.offset || 0, options.headerOnly ? 256 * 1024 - 1 : undefined)) {
      if (currentRaw && options.on_raw) await options.on_raw(currentRaw)
      currentRaw = undefined
      const line = record.text
      summary.diagnostics.totalLines++; if (!line.trim()) continue
      let value: any; try { value = JSON.parse(line) } catch { if (!options.headerOnly) summary.diagnostics.malformedLines++; continue }
      const index = rawRecords.length; const timestamp = typeof value?.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp)) ? value.timestamp : undefined
      if (timestamp) { if (!summary.startedAt || timestamp < summary.startedAt) summary.startedAt = timestamp; if (!summary.updatedAt || timestamp > summary.updatedAt) summary.updatedAt = timestamp }
      currentRaw = (includeRaw || options.on_raw) ? { line: summary.diagnostics.totalLines, timestamp, type: value?.type, value, raw: line, turnId, sourceFile: file.path } : undefined; if (currentRaw && includeRaw) rawRecords.push(currentRaw)
      const payload = value?.payload; if (!payload || typeof payload !== 'object') { summary.diagnostics.ignoredRecords++; continue }
      if (value.type === 'session_meta') { summary.id = typeof payload.id === 'string' ? payload.id : typeof payload.session_id === 'string' ? payload.session_id : summary.id; if (typeof payload.cwd === 'string' && payload.cwd.trim()) summary.projectPath = payload.cwd; if (currentRaw) currentRaw.turnId = undefined; continue }
      if (value.type === 'turn_context') { explicitTurn = typeof payload.turn_id === 'string' ? `${prefix}-${payload.turn_id}` : undefined; if (explicitTurn) { turnId = explicitTurn; if (currentRaw) currentRaw.turnId = turnId; assistant = undefined }; continue }
      if (value.type === 'event_msg' && payload.type === 'task_started') { explicitTurn = typeof payload.turn_id === 'string' ? `${prefix}-${payload.turn_id}` : undefined; turnId = explicitTurn; if (currentRaw) currentRaw.turnId = turnId; if (includeRaw && !turnId) pendingIndexes.push(index); assistant = undefined; continue }
      if (value.type === 'event_msg' && typeof payload.turn_id === 'string' && payload.turn_id.trim()) { explicitTurn = `${prefix}-${payload.turn_id}`; turnId = explicitTurn; if (currentRaw) currentRaw.turnId = turnId }
      const response = value.type === 'response_item'; const event = value.type === 'event_msg'
      const role = response && payload.type === 'message' ? payload.role : event && payload.type === 'user_message' ? 'user' : event && payload.type === 'agent_message' ? 'assistant' : undefined
      if (role === 'user' || role === 'assistant') {
        const original_text = response ? textContent(payload.content) : textContent(payload.message || payload.text)
        const text = role === 'user' ? clean_user_text(original_text) : original_text
        if (!text.trim()) { summary.diagnostics.ignoredRecords++; continue }
        const source = response ? 'response' : 'event'; if (previous && previous.role === role && previous.text === createHash('sha256').update(text).digest('hex') && previous.source !== source && previous.turn === explicitTurn) { previous = undefined; continue }; previous = { role, text: createHash('sha256').update(text).digest('hex'), source, turn: explicitTurn }
        if (role === 'user' && options.maxBlocks && blocks.length >= options.maxBlocks) {
          nextCursor = { fileIndex: 0, offset: record.offset, line: summary.diagnostics.totalLines - 1, turnId: explicitTurn }
          break
        }
        const displayText = previewText(text, maxTextLength)
        if (role === 'user') { await newBlock(role, displayText, index, timestamp); if (!firstUser) firstUser = text.slice(0, 1000) }
        else if (assistant && !assistant.text) {
          assistant.text = displayText; if (includeRaw) assistant.rawRecordIndexes.push(index)
          if (options.on_message) { await options.on_message(assistant, true); assistant.text = '…' }
        } else assistant = await newBlock(role, displayText, index, timestamp)
        if (options.headerOnly && firstUser) break
        continue
      }
      if (response && /^(custom_tool_call|function_call|local_shell_call|web_search_call)(?:_output)?$/.test(payload.type || '')) {
        if (!assistant) assistant = await newBlock('assistant', '', index, timestamp); if (currentRaw) currentRaw.turnId = assistant.turnId
        if (summaryOnly || options.includeTools === false) continue
        const isResult = /_output$/.test(payload.type); const callId = String(payload.call_id || payload.id || `${prefix}-${summary.diagnostics.totalLines}`); let entry = calls.get(callId)
        if (!entry) { const tool: SessionToolBlock = { id: callId, kind: isResult ? 'result' : 'call', rawRecordIndexes: [] }; entry = { tool, owner: assistant }; assistant.tools.push(tool); calls.set(callId, entry) }
        const { tool, owner } = entry
        if (isResult) tool.result = previewText(printable(payload.output), maxTextLength); else { tool.name = payload.name || payload.type; tool.input = previewText(printable(payload.input ?? payload.arguments ?? payload.action), maxTextLength) }; if (includeRaw) { tool.rawRecordIndexes.push(index); owner.rawRecordIndexes.push(index) }
        if (options.on_tool) { await options.on_tool(owner, tool, isResult); tool.input = undefined; tool.result = undefined }
        continue
      }
      summary.diagnostics.ignoredRecords++
  }
  if (currentRaw && options.on_raw) await options.on_raw(currentRaw)
  summary.title = firstUser.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 120) || summary.id; summary.preview = firstUser.replace(/\s+/g, ' ').slice(0, 180); summary.updatedAt = options.headerOnly ? fileStat.mtime.toISOString() : summary.updatedAt || fileStat.mtime.toISOString(); summary.fileCount = 1
  if (options.headerOnly) summary.messageCountKnown = false
  return { summary, blocks, rawRecords, nextCursor }
}
