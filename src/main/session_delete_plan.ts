import { createHash } from 'node:crypto'
import { read_session_lines } from './session_lines'
import { clean_user_text } from './session_parser'
import type { SessionFileRef } from '../shared/types'

export interface SessionDeletePlan {
  turnIds: string[]
  userBlockCount: number
  assistantBlockCount: number
  toolRecordCount: number
  rawRecordCount: number
  warnings: string[]
  files: Array<{ path: string; ranges: Array<{ start: number; end: number }> }>
}

const tool_re = /^(custom_tool_call|function_call|local_shell_call|web_search_call)(?:_output)?$/
function obj(v: unknown): Record<string, any> | undefined { return v && typeof v === 'object' ? v as Record<string, any> : undefined }
function turn_of(v: Record<string, any>): string | undefined {
  const p = obj(v.payload)
  if (v.type === 'turn_context' || (v.type === 'event_msg' && p?.type === 'task_started')) return typeof p?.turn_id === 'string' && p.turn_id.trim() ? p.turn_id : undefined
  if (v.type === 'event_msg' && typeof p?.turn_id === 'string' && p.turn_id.trim()) return p.turn_id
  return undefined
}
function role_of(v: Record<string, any>): 'user' | 'assistant' | undefined {
  const p = obj(v.payload)
  if (v.type === 'response_item' && p?.type === 'message' && (p.role === 'user' || p.role === 'assistant')) return p.role
  if (v.type === 'event_msg' && (p?.type === 'user_message' || p?.type === 'agent_message')) return p?.type === 'user_message' ? 'user' : 'assistant'
  return undefined
}
function text_of(v: Record<string, any>): string {
  const p = obj(v.payload); const c = v.type === 'event_msg' ? (p?.message ?? p?.text) : p?.content
  if (typeof c === 'string') return c
  return Array.isArray(c) ? c.map(x => obj(x)?.text || '').filter(Boolean).join('\n') : ''
}

/** 根据 parseSessionFile 的 block id 规划整轮删除，返回原文件字节半开区间。 */
export async function plan_session_deletion(refs: SessionFileRef[], selectedBlockIds: string[]): Promise<SessionDeletePlan> {
  if (!refs.length || !selectedBlockIds.length) throw new Error('会话文件或删除选择为空')
  const selected = new Set(selectedBlockIds); const selectedTurns = new Set<string>(); const warnings: string[] = []
  let userBlockCount = 0; let assistantBlockCount = 0; let toolRecordCount = 0; let rawRecordCount = 0
  const fileRows: Array<{ ref: SessionFileRef; rows: Array<{ start: number; end: number; turn?: string; block?: string; role?: 'user'|'assistant'; tool: boolean; safe: boolean }> }> = []
  for (const ref of refs) {
    const prefix = createHash('sha256').update(ref.path).digest('hex').slice(0, 16)
    let lineNo = 0; let currentTurn: string | undefined; let hasExplicitTurn = false; let previousMessage: { role: 'user'|'assistant'; hash: string; source: 'response'|'event'; turn?: string } | undefined; const calls = new Map<string, string>(); const rows: typeof fileRows[number]['rows'] = []; const seenMessages = new Set<string>(); const activeBlocks = new Map<string, string>(); const assistantHasText = new Set<string>()
    for await (const line of read_session_lines(ref.path)) {
      lineNo++; const base = { start: line.offset, end: line.next, turn: undefined as string|undefined, block: undefined as string|undefined, role: undefined as 'user'|'assistant'|undefined, tool: false, safe: true }
      if (!line.text.trim()) { rows.push(base); continue }
      let v: Record<string, any>; try { v = JSON.parse(line.text) } catch { base.turn = currentTurn; base.safe = !currentTurn; rows.push(base); continue }
      const p = obj(v.payload); const explicit = turn_of(v)
      // 显式 turn_id 在多个 JSONL 分段中保持同一 canonical key，才能把跨文件的同一轮一起删除。
      if (explicit) { currentTurn = explicit; hasExplicitTurn = true }
      if (v.type === 'session_meta') { base.safe = true; rows.push(base); continue }
      if (explicit) base.turn = currentTurn
      if (String(v.type).toLowerCase().includes('compact') || String(p?.type || '').toLowerCase().includes('compact')) base.safe = false
      const pt = typeof p?.type === 'string' ? p.type : ''
      if (tool_re.test(pt)) {
        const id = p?.call_id ?? p?.id
        if (pt.endsWith('_output') && id != null && calls.has(String(id))) currentTurn = calls.get(String(id))
        if (!currentTurn) currentTurn = `${prefix}-turn-${lineNo}`
        base.turn = currentTurn; base.tool = true
        if (!activeBlocks.has(`${currentTurn}|assistant`)) activeBlocks.set(`${currentTurn}|assistant`, `${prefix}-block-${lineNo}`)
        if (!pt.endsWith('_output') && id != null) calls.set(String(id), currentTurn)
        rows.push(base); continue
      }
      const role = role_of(v)
      if (role) {
        const normalized = role === 'user' ? clean_user_text(text_of(v)).trim() : text_of(v).trim()
        const source = v.type === 'event_msg' ? 'event' : 'response'
        const messageHash = createHash('sha256').update(normalized).digest('hex')
        const mirror = previousMessage && previousMessage.role === role && previousMessage.hash === messageHash && previousMessage.source !== source && previousMessage.turn === currentTurn
        if (!currentTurn || role === 'user' && !hasExplicitTurn && !explicit && !mirror) currentTurn = `${prefix}-turn-${lineNo}`
        base.turn = currentTurn; base.role = role
        const messageKey = `${currentTurn}|${role}|${messageHash}`
        if (!seenMessages.has(messageKey) && !mirror) {
          const active = role === 'assistant' && !assistantHasText.has(`${currentTurn}|assistant`) ? activeBlocks.get(`${currentTurn}|assistant`) : undefined
          base.block = active || `${prefix}-block-${lineNo}`
          activeBlocks.set(`${currentTurn}|${role}`, base.block)
          if (role === 'assistant') assistantHasText.add(`${currentTurn}|assistant`)
        }
        seenMessages.add(messageKey)
        previousMessage = !normalized ? undefined : mirror ? undefined : { role, hash: messageHash, source, turn: currentTurn }
        // 注入过滤后为空的用户记录不会产生 UI block。
        if (role === 'user' && !clean_user_text(text_of(v)).trim()) base.block = undefined
        rows.push(base); continue
      }
      base.turn = currentTurn; rows.push(base)
    }
    fileRows.push({ ref, rows })
  }
  for (const file of fileRows) for (const row of file.rows) if (row.block && selected.has(row.block)) selectedTurns.add(row.turn!)
  if (!selectedTurns.size || selectedBlockIds.some(id => !fileRows.some(f => f.rows.some(r => r.block === id)))) throw new Error('所选消息不存在或已刷新，请重新选择')
  for (const file of fileRows) {
    const chosen = file.rows.filter(r => r.turn && selectedTurns.has(r.turn))
    if (chosen.some(r => !r.safe)) throw new Error('选中轮次包含无法安全归属的记录，已拒绝删除')
    const ranges: Array<{start:number;end:number}> = []; const counted = new Set<string>()
    for (const r of chosen) { if (r.role) { const key = `${r.turn}|${r.role}|${r.block || ''}`; if (r.block && !counted.has(key)) { if (r.role === 'user') userBlockCount++; else assistantBlockCount++; counted.add(key) } } if (r.tool) toolRecordCount++; rawRecordCount++; const last = ranges[ranges.length-1]; if (last && last.end === r.start) last.end = r.end; else ranges.push({start:r.start,end:r.end}) }
    ;(file as any).ranges = ranges
  }
  if (selectedTurns.size) warnings.push('删除按完整轮次执行；当前未加载的同轮 AI 回复、工具调用、工具结果和原始事件也会一并删除。')
  return { turnIds: [...selectedTurns], userBlockCount, assistantBlockCount, toolRecordCount, rawRecordCount, warnings, files: fileRows.filter(f => (f as any).ranges?.length).map(f => ({ path: f.ref.path, ranges: (f as any).ranges })) }
}
