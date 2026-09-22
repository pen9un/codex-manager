import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverSessionFiles, parseSessionFile, parseSessionIndex, resolveCodexHome } from '../src/main/session_parser'

const record = (type: string, payload: unknown, timestamp = '2026-09-18T01:00:00.000Z'): string => JSON.stringify({ timestamp, type, payload })

describe('Codex 会话路径与 JSONL 解析', () => {
  it('优先使用 CODEX_HOME，否则使用用户目录下的 .codex', () => {
    expect(resolveCodexHome({ CODEX_HOME: 'D:/codex-home' }, 'C:/Users/test')).toBe('D:/codex-home')
    expect(resolveCodexHome({}, 'C:/Users/test').replaceAll('\\', '/')).toBe('C:/Users/test/.codex')
  })

  it('发现 sessions 和 archived_sessions 中的 rollout 文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-discovery-'))
    await mkdir(join(root, 'sessions', '2026', '09', '18'), { recursive: true })
    await mkdir(join(root, 'archived_sessions', '2026'), { recursive: true })
    const active = join(root, 'sessions', '2026', '09', '18', 'rollout-active.jsonl')
    const archived = join(root, 'archived_sessions', '2026', 'rollout-archived.jsonl')
    await writeFile(active, `${record('session_meta', { id: 'active' })}\n`)
    await writeFile(archived, `${record('session_meta', { id: 'archived' })}\n`)
    await writeFile(join(root, 'sessions', 'ignore.txt'), 'ignore')

    const files = await discoverSessionFiles(root)
    expect(files.map(file => file.id).sort()).toEqual(['active', 'archived'])
    expect(files.find(file => file.id === 'archived')?.archived).toBe(true)
  })

  it('解析用户、AI、工具和损坏行，并保留项目诊断', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-parse-'))
    const path = join(root, 'rollout-session-1.jsonl')
    const lines = [
      record('session_meta', { id: 'session-1', cwd: 'D:/workspace/demo', timestamp: '2026-09-18T01:00:00.000Z' }),
      record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '请检查项目状态' }] }),
      record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我会检查。' }] }),
      record('response_item', { type: 'custom_tool_call', call_id: 'call-1', name: 'exec_command', input: '{"cmd":"pwd"}' }),
      record('response_item', { type: 'custom_tool_call_output', call_id: 'call-1', output: 'D:/workspace/demo' }),
      '{损坏记录',
    ]
    await writeFile(path, `${lines.join('\n')}\n`)

    const result = await parseSessionFile({ id: 'session-1', path, archived: false })
    expect(result.summary.projectPath).toBe('D:/workspace/demo')
    expect(result.blocks.map(block => block.role)).toEqual(['user', 'assistant'])
    expect(result.blocks[0].text).toContain('请检查项目状态')
    expect(result.blocks[1].tools).toHaveLength(1)
    expect(result.blocks[1].tools[0].result).toContain('D:/workspace/demo')
    expect(result.summary.diagnostics.malformedLines).toBe(1)
  })

  it('从 session_index.jsonl 读取会话标题', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-index-'))
    await writeFile(join(root, 'session_index.jsonl'), `${JSON.stringify({ id: 'session-1', thread_name: '项目会话标题' })}\n`)
    expect(await parseSessionIndex(root)).toEqual(new Map([['session-1', '项目会话标题']]))
  })
})
