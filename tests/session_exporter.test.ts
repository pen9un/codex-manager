import { describe, expect, it } from 'vitest'
import type { SessionDetail } from '../src/shared/types'
import { renderMarkdown, export_filename, write_session_export } from '../src/main/session_exporter'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSessionFile } from '../src/main/session_parser'

const fixture: SessionDetail = {
  summary: {
    id: 'session-1', title: '导出测试会话', filePath: 'D:/codex/sessions/rollout-session-1.jsonl', projectPath: 'D:/workspace/demo',
    startedAt: '2026-09-18T01:00:00.000Z', updatedAt: '2026-09-18T01:02:00.000Z', messageCount: 2, archived: false, fileSize: 12,
    diagnostics: { malformedLines: 0, ignoredRecords: 0, totalLines: 6 },
  },
  blocks: [
    { id: 'user-1', turnId: 'turn-1', role: 'user', text: '请检查项目状态', timestamp: '2026-09-18T01:00:00.000Z', tools: [], rawRecordIndexes: [0] },
    { id: 'assistant-1', turnId: 'turn-1', role: 'assistant', text: '检查完成。', timestamp: '2026-09-18T01:02:00.000Z', tools: [{ id: 'tool-1', kind: 'call', name: 'exec_command', input: 'pwd', result: 'D:/workspace/demo', rawRecordIndexes: [2, 3] }], rawRecordIndexes: [1, 2, 3] },
  ],
  rawRecords: [
    { line: 1, type: 'session_meta', value: { type: 'session_meta' } },
    { line: 2, type: 'response_item', value: { type: 'response_item', payload: { role: 'assistant' } } },
    { line: 3, type: 'response_item', value: { type: 'response_item', payload: { type: 'custom_tool_call' } } },
    { line: 4, type: 'response_item', value: { type: 'response_item', payload: { type: 'custom_tool_call_output' } } },
  ],
}

describe('Codex 会话 Markdown 导出', () => {
  it('文件名保留项目与会话标题并清理 Windows 非法字符', () => {
    expect(export_filename([fixture.summary], '2026-09-18')).toBe('demo-导出测试会话-2026-09-18.md')
    expect(export_filename([{ ...fixture.summary, title: '修复:加载/问题?' }], '2026-09-18')).not.toMatch(/[:/\\?]/)
  })

  it('流式四档导出边界正确且原始记录逐行保留', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-stream-'))
    const source = join(root, 'rollout-s.jsonl')
    const rows = [
      { type: 'session_meta', payload: { id: 'session-1' } },
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: '开发者规则标记' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: '真实指令标记' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'c', name: '工具标记', arguments: '输入标记' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c', output: '结果标记' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: '回复标记' } },
    ].map(item => JSON.stringify(item))
    await writeFile(source, rows.join('\n'))
    for (const scope of ['user', 'conversation', 'with_tools', 'raw'] as const) {
      const target = join(root, `${scope}.md`)
      await write_session_export(target, [{ summary: fixture.summary, files: [{ id: 'session-1', path: source, archived: false }] }], scope)
      const output = await readFile(target, 'utf8')
      expect(output).toContain('真实指令标记')
      expect(output.includes('回复标记')).toBe(scope !== 'user')
      expect(output.includes('结果标记')).toBe(scope === 'with_tools' || scope === 'raw')
      expect(output.includes('开发者规则标记')).toBe(scope === 'raw')
      if (scope === 'raw') for (const record of rows) expect(output).toContain(record)
    }
  })

  it('部分流式导出只保留所选 AI 及其工具，原始档按对应轮次筛选', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-selected-'))
    const source = join(root, 'rollout-s.jsonl')
    const rows = [
      { type: 'session_meta', payload: { id: 'session-1' } },
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: '全局规则' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: '第一问题' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'c', name: '工具甲', arguments: '参数甲' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c', output: '```\n工具原文\n```' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: '第一回答' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: '第二问题' } },
      { type: 'response_item', payload: { type: 'reasoning', summary: '第二推理' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: '第二回答' } },
    ]
    await writeFile(source, rows.map(item => JSON.stringify(item)).join('\n'))
    const file = { id: 'session-1', path: source, archived: false }
    const detail = await parseSessionFile(file)
    const selected = { 'session-1': [detail.blocks[1].id] }
    for (const scope of ['with_tools', 'raw'] as const) {
      const target = join(root, `${scope}.md`)
      await write_session_export(target, [{ summary: fixture.summary, files: [file] }], scope, selected)
      const output = await readFile(target, 'utf8')
      expect(output).toContain('第一回答')
      expect(output).toContain('工具甲')
      expect(output).toContain('````text\n```\n工具原文\n```\n````')
      expect(output).not.toContain('第二问题')
      expect(output).not.toContain('第二推理')
      expect(output).not.toContain('第二回答')
      if (scope === 'with_tools') expect(output).not.toContain('第一问题')
      else { expect(output).toContain('第一问题'); expect(output).toContain('全局规则') }
    }
    const target = join(root, 'existing.md')
    await writeFile(target, '已有文件')
    await expect(write_session_export(target, [{ summary: fixture.summary, files: [file] }], 'user', selected)).rejects.toThrow('没有可导出的消息块')
    expect(await readFile(target, 'utf8')).toBe('已有文件')
  })
  it('仅用户范围不包含 AI 和工具内容', () => {
    const output = renderMarkdown([fixture], 'user')
    expect(output).toContain('请检查项目状态')
    expect(output).not.toContain('检查完成')
    expect(output).not.toContain('exec_command')
  })

  it('conversation 范围包含用户和 AI，但不包含工具块', () => {
    const output = renderMarkdown([fixture], 'conversation')
    expect(output).toContain('请检查项目状态')
    expect(output).toContain('检查完成')
    expect(output).not.toContain('exec_command')
  })

  it('with_tools 范围包含 AI 回复下的工具调用和结果', () => {
    const output = renderMarkdown([fixture], 'with_tools')
    expect(output).toContain('exec_command')
    expect(output).toContain('D:/workspace/demo')
  })

  it('raw 范围包含选中轮次的原始记录', () => {
    const output = renderMarkdown([fixture], 'raw', { 'session-1': ['assistant-1'] })
    expect(output).toContain('原始记录')
    expect(output).toContain('session_meta')
    expect(output).toContain('检查完成')
    expect(output).not.toContain('请检查项目状态')
  })

  it('没有可导出的会话或消息块时拒绝生成空文件', () => {
    expect(() => renderMarkdown([], 'conversation')).toThrow('没有可导出的会话')
    expect(() => renderMarkdown([fixture], 'conversation', { 'session-1': [] })).toThrow('没有可导出的消息块')
  })

  it('延迟到达的工具结果仍属于发起调用的 AI 回复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-tool-owner-'))
    const source = join(root, 'rollout-s.jsonl')
    const rows = [
      { type: 'message', role: 'user', content: '执行' },
      { type: 'message', role: 'assistant', content: '回复甲' },
      { type: 'function_call', call_id: 'c', name: '工具甲', arguments: '{}' },
      { type: 'message', role: 'assistant', content: '回复乙' },
      { type: 'function_call_output', call_id: 'c', output: '延迟结果' },
    ]
    await writeFile(source, rows.map(payload => JSON.stringify({ type: 'response_item', payload })).join('\n'))
    const file = { id: 'session-1', path: source, archived: false }
    const detail = await parseSessionFile(file)
    const target = join(root, 'selected.md')
    await write_session_export(target, [{ summary: fixture.summary, files: [file] }], 'with_tools', { 'session-1': [detail.blocks[1].id] })
    expect(await readFile(target, 'utf8')).toContain('延迟结果')
  })

  it('项目导出支持多会话并按会话分别应用消息块选择', () => {
    const second: SessionDetail = {
      ...fixture,
      summary: { ...fixture.summary, id: 'session-2', title: '第二个会话' },
      blocks: [
        { id: 'user-2', turnId: 'turn-2', role: 'user', text: '第二个问题', timestamp: fixture.blocks[0].timestamp, tools: [], rawRecordIndexes: [0] },
        { id: 'assistant-2', turnId: 'turn-2', role: 'assistant', text: '第二个回答', timestamp: fixture.blocks[1].timestamp, tools: [], rawRecordIndexes: [1] },
      ],
    }
    const output = renderMarkdown([fixture, second], 'conversation', { 'session-1': ['user-1'], 'session-2': ['assistant-2'] })
    expect(output).toContain('导出测试会话')
    expect(output).toContain('请检查项目状态')
    expect(output).not.toContain('检查完成')
    expect(output).toContain('第二个会话')
    expect(output).toContain('第二个回答')
    expect(output).not.toContain('第二个问题')
  })
})
