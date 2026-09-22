import type { SessionDetail, SessionExportScope, SessionMessageBlock, SessionRawRecord, SessionToolBlock } from '../shared/types'
import type { SessionFileRef, SessionSummary } from '../shared/types'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { parseSessionFile } from './session_parser'

export function export_filename(summaries: SessionSummary[], date = new Date().toISOString().slice(0, 10)): string {
  const project_names = new Set(summaries.map(item => item.projectName || item.projectPath?.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '未归属项目'))
  const project = project_names.size === 1 ? [...project_names][0] : '多个项目'
  const title = summaries.length === 1 ? summaries[0].title : `${summaries.length}个会话`
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 80)
  return `${safe(project)}-${safe(title)}-${date}.md`
}

function code_fence(value: string, language = 'text'): string {
  let width = 3
  for (const match of value.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1)
  const fence = '`'.repeat(width)
  return `${fence}${language}\n${value}\n${fence}\n\n`
}

// 输出边读边写，遵守写入背压；成功后发布文件，失败不覆盖用户的旧文件。
export async function write_session_export(path: string, sessions: Array<{ summary: SessionSummary; files: SessionFileRef[] }>, scope: SessionExportScope, selected?: Record<string, string[]>): Promise<void> {
  if (!sessions.length) throw new Error('没有可导出的会话')
  const temporary = `${path}.${randomUUID()}.tmp`
  const output = createWriteStream(temporary, { flags: 'wx', encoding: 'utf8' })
  const completion = finished(output)
  // 错误同时交由 write/drain 和最终完成状态处理，防止等待期间出现未处理拒绝。
  void completion.catch(() => {})
  const write = async (text: string) => { if (output.destroyed) throw new Error('导出文件写入失败'); if (!output.write(text)) await once(output, 'drain') }
  let emitted = 0
  try {
    await write(`# Codex 会话导出\n\n导出范围：${scopeLabel(scope)}\n\n`)
    for (const { summary, files } of sessions) {
      const ids = selected && summary.id in selected ? new Set(selected[summary.id]) : undefined
      if (ids && !ids.size) throw new Error('没有可导出的消息块')
      const turns = new Set<string>()
      let matched = 0
      let last_block_id: string | undefined
      await write(`## ${summary.title}\n\n项目：${summary.projectName || summary.projectPath || '未归属项目'}\n\n会话 ID：${summary.id}\n\n`)
      for (const file of files) {
        await parseSessionFile(file, false, {
          includeRaw: false, includeTools: scope === 'with_tools' || scope === 'raw',
          on_message: async (block, continuation) => {
            if (ids && !ids.has(block.id)) return
            turns.add(block.turnId)
            if (!continuation) matched++
            if (scope === 'user' && block.role !== 'user') return
            emitted++
            if (!continuation || last_block_id !== block.id) await write(`### ${block.role === 'user' ? '用户' : 'Codex'}\n\n`)
            last_block_id = block.id
            if (block.text) await write(`${block.text}\n\n`)
          },
          on_tool: async (block, tool, is_result) => {
            if (ids && !ids.has(block.id)) return
            if (last_block_id !== block.id) { await write('### Codex（先前回复的工具结果）\n\n'); last_block_id = block.id }
            await write(`#### ${is_result ? '工具结果' : `工具调用：${tool.name || '工具'}`}\n\n${code_fence((is_result ? tool.result : tool.input) || '')}`)
          },
        })
      }
      if (ids && !matched) throw new Error('没有可导出的消息块')
      if (scope === 'raw') {
        await write('### 原始记录\n\n```jsonl\n')
        for (const file of files) await parseSessionFile(file, true, {
          includeRaw: false,
          on_raw: async record => { if (!ids || !record.turnId || turns.has(record.turnId)) { await write(`${record.raw || JSON.stringify(record.value)}\n`); emitted++ } },
        })
        await write('```\n\n')
      }
    }
    if (!emitted) throw new Error('没有可导出的消息块')
    output.end(); await completion
    await rename(temporary, path)
  } catch (error) { output.destroy(); await completion.catch(() => {}); await rm(temporary, { force: true }); throw error }
}

function fenced(value: string): string { return value }

function toolMarkdown(tool: SessionToolBlock): string {
  const lines: string[] = []
  if (tool.name) lines.push(`### 工具调用：${tool.name}`)
  else lines.push('### 工具调用')
  if (tool.input) lines.push('', '```text', fenced(tool.input), '```')
  if (tool.result) lines.push('', '### 工具结果', '', '```text', fenced(tool.result), '```')
  return lines.join('\n')
}

function rawMarkdown(records: SessionRawRecord[]): string {
  return records.map(record => JSON.stringify(record.value)).join('\n')
}

function selectedBlocks(session: SessionDetail, selectedBlockIds: Record<string, string[]> | undefined): SessionMessageBlock[] {
  if (!selectedBlockIds || !(session.summary.id in selectedBlockIds)) return session.blocks
  const ids = new Set(selectedBlockIds[session.summary.id])
  return session.blocks.filter(block => ids.has(block.id))
}

function visibleBlocks(blocks: SessionMessageBlock[], scope: SessionExportScope): SessionMessageBlock[] {
  if (scope === 'user') return blocks.filter(block => block.role === 'user')
  return blocks
}

export function renderMarkdown(sessions: SessionDetail[], scope: SessionExportScope, selectedBlockIds?: Record<string, string[]>): string {
  if (!sessions.length) throw new Error('没有可导出的会话')
  const sections: string[] = []
  for (const session of sessions) {
    const selected = selectedBlocks(session, selectedBlockIds)
    if (selectedBlockIds && session.summary.id in selectedBlockIds && selected.length === 0) throw new Error('没有可导出的消息块')
    const blocks = visibleBlocks(selected, scope)
    if (scope !== 'raw' && !blocks.length) continue
    const { summary } = session
    const header = [
      `## ${summary.title}`,
      '',
      `项目：${summary.projectPath || '未归属项目'}`,
      `会话 ID：${summary.id}`,
      `时间：${summary.startedAt || '未知'} — ${summary.updatedAt || '未知'}`,
      `导出范围：${scopeLabel(scope)}`,
      '',
    ]
    const body: string[] = []
    for (const block of blocks) {
      body.push(`### ${block.role === 'user' ? '用户' : 'Codex'}`, '', block.text || '（空消息）', '')
      if (scope === 'with_tools' || scope === 'raw') for (const tool of block.tools) body.push(toolMarkdown(tool), '')
    }
    if (scope === 'raw') {
      const selectedTurnIds = new Set(blocks.map(block => block.turnId))
      const indexes = selectedBlockIds && summary.id in (selectedBlockIds || {}) ? new Set(blocks.flatMap(block => block.rawRecordIndexes)) : undefined
      const records = indexes ? session.rawRecords.filter((record, index) => indexes.has(index) || !record.turnId || (record.turnId && selectedTurnIds.has(record.turnId))) : session.rawRecords
      if (records.length) body.push('### 原始记录', '', '```jsonl', rawMarkdown(records), '```', '')
    }
    sections.push([...header, ...body].join('\n').trim())
  }
  if (!sections.length) throw new Error('没有可导出的消息块')
  const project = sessions.length === 1 ? sessions[0].summary.title : sessions[0].summary.projectPath || 'Codex 会话导出'
  return [`# ${project}`, '', `生成时间：${new Date().toISOString()}`, '', ...sections].join('\n\n') + '\n'
}

function scopeLabel(scope: SessionExportScope): string {
  return { user: '仅用户指令', conversation: '用户指令 + AI 回复', with_tools: '用户指令 + AI 回复 + 工具调用和工具结果', raw: '全部原始记录' }[scope]
}
