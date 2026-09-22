import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseSessionFile } from '../src/main/session_parser'
import { createSessionService } from '../src/main/session_service'
import { renderMarkdown } from '../src/main/session_exporter'

const row = (type: string, payload: unknown) => JSON.stringify({ timestamp: '2026-09-18T01:00:00Z', type, payload })
const message = (role: string, text: string) => row('response_item', { type: 'message', role, content: [{ type: 'input_text', text }] })
async function fixture(lines: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'session-compat-'))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-a.jsonl')
  await writeFile(path, lines.join('\n'))
  return { root, path }
}

it('工具先于 AI 正文出现仍归属同一回复，按调用 ID 配对', async () => {
  const { path } = await fixture([
    row('session_meta', { id: 's' }), message('user', '执行'),
    row('response_item', { type: 'function_call', call_id: 'a', name: '甲', arguments: '参数甲' }),
    row('response_item', { type: 'function_call', call_id: 'b', name: '乙', arguments: '参数乙' }),
    row('response_item', { type: 'function_call_output', call_id: 'b', output: '结果乙' }),
    row('response_item', { type: 'function_call_output', call_id: 'a', output: '结果甲' }), message('assistant', '完成'),
  ])
  const detail = await parseSessionFile({ id: 's', path, archived: false })
  expect(detail.blocks.map(b => b.role)).toEqual(['user', 'assistant'])
  expect(detail.blocks[1].tools.map(t => [t.name, t.result])).toEqual([['甲', '结果甲'], ['乙', '结果乙']])
  expect(detail.blocks[1].text).toBe('完成')
})

it('过滤注入的用户上下文并去除 event_msg 镜像，不合并实际重复指令', async () => {
  const { path } = await fixture([
    row('session_meta', { id: 's' }), message('user', '<environment_context>本机信息</environment_context>'),
    row('event_msg', { type: 'user_message', message: '继续' }), message('user', '继续'),
    message('assistant', '收到'), row('event_msg', { type: 'agent_message', message: '收到' }),
    row('event_msg', { type: 'user_message', message: '继续' }), message('user', '继续'),
  ])
  const detail = await parseSessionFile({ id: 's', path, archived: false })
  expect(detail.blocks.map(b => b.text)).toEqual(['继续', '收到', '继续'])
})

it('同 ID 多段会话合并且缓存刷新反映新增段', async () => {
  const { root } = await fixture([row('session_meta', { id: 's', cwd: 'D:/demo' }), message('user', '第一段')])
  await writeFile(join(root, 'sessions', 'rollout-b.jsonl'), [row('session_meta', { id: 's', cwd: 'D:/demo' }), message('user', '第二段')].join('\n'))
  const service = createSessionService({ env: { CODEX_HOME: root } })
  const catalog = await service.list()
  expect(catalog.sessions).toHaveLength(1)
  expect((await service.detail('s')).blocks.map(b => b.text)).toEqual(['第一段', '第二段'])
})

it('部分原始导出包含所选轮次系统和推理，但排除其他轮次', async () => {
  const { path } = await fixture([
    row('session_meta', { id: 's' }), message('system', '全局规则'),
    message('user', '第一问'), row('response_item', { type: 'reasoning', summary: [{ text: '第一推理' }] }), message('assistant', '第一答'),
    message('user', '第二问'), row('response_item', { type: 'reasoning', summary: [{ text: '第二推理' }] }), message('assistant', '第二答'),
  ])
  const detail = await parseSessionFile({ id: 's', path, archived: false })
  const output = renderMarkdown([detail], 'raw', { s: [detail.blocks[1].id] })
  expect(output).toContain('全局规则')
  expect(output).toContain('第一推理')
  expect(output).not.toContain('第二推理')
  expect(output).not.toContain('第二问')
})

it('Markdown 围栏不修改工具输出原文', async () => {
  const { path } = await fixture([row('session_meta', { id: 's' }), message('user', '执行'), message('assistant', '结果'), row('response_item', { type: 'custom_tool_call', call_id: 'a', input: '```原文```' })])
  const detail = await parseSessionFile({ id: 's', path, archived: false })
  expect(renderMarkdown([detail], 'with_tools')).toContain('```原文```')
})
