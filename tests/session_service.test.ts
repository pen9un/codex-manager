import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSessionService } from '../src/main/session_service'

const line = (type: string, payload: unknown): string => JSON.stringify({ timestamp: '2026-09-18T01:00:00.000Z', type, payload })

describe('Codex 会话目录服务', () => {
  it('详情请求会先建立索引，并按项目分组列表', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-service-'))
    const folder = join(root, 'sessions', '2026', '09', '18')
    await mkdir(folder, { recursive: true })
    const path = join(folder, 'rollout-service-1.jsonl')
    await writeFile(path, [
      line('session_meta', { id: 'service-1', cwd: 'D:/workspace/demo' }),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '服务测试' }] }),
    ].join('\n') + '\n')
    const service = createSessionService({ env: { CODEX_HOME: root }, homeDir: 'C:/Users/test' })

    const detail = await service.detail('service-1')
    expect(detail.summary.projectPath).toBe('D:/workspace/demo')
    expect(detail.rawRecords).toHaveLength(0)
    const export_detail = await service.detail('service-1', { includeRaw: true })
    expect(export_detail.rawRecords.length).toBeGreaterThan(0)
    const catalog = await service.list()
    expect(catalog.projects[0].sessionCount).toBe(1)
    expect(catalog.sessions[0].title).toBe('服务测试')
  })

  it('同一项目的活动与归档会话分别列出并汇总项目数量', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-projects-'))
    const active_folder = join(root, 'sessions', '2026', '09', '18')
    const archived_folder = join(root, 'archived_sessions', '2026', '09', '18')
    await mkdir(active_folder, { recursive: true }); await mkdir(archived_folder, { recursive: true })
    await writeFile(join(active_folder, 'rollout-active.jsonl'), [line('session_meta', { id: 'active', cwd: 'D:/workspace/demo' }), line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '活动会话' }] })].join('\n') + '\n')
    await writeFile(join(archived_folder, 'rollout-archived.jsonl'), [line('session_meta', { id: 'archived', cwd: 'D:/workspace/demo' }), line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '归档会话' }] })].join('\n') + '\n')
    const catalog = await createSessionService({ env: { CODEX_HOME: root } }).list()
    expect(catalog.projects).toHaveLength(1)
    expect(catalog.projects[0].sessionCount).toBe(2)
    expect(catalog.sessions.map(item => item.id).sort()).toEqual(['active', 'archived'])
    expect(catalog.sessions.find(item => item.id === 'archived')?.archived).toBe(true)
  })

  it('详情预览截断超长消息并保留导出所需的摘要信息', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-preview-'))
    const folder = join(root, 'sessions', '2026', '09', '18')
    await mkdir(folder, { recursive: true })
    const long_text = '超长内容'.repeat(30_000)
    await writeFile(join(folder, 'rollout-preview.jsonl'), [
      line('session_meta', { id: 'preview', cwd: 'D:/workspace/preview' }),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: long_text }] }),
    ].join('\n') + '\n')
    const detail = await createSessionService({ env: { CODEX_HOME: root } }).detail('preview')
    expect(detail.rawRecords).toHaveLength(0)
    expect(detail.blocks[0].text.length).toBeLessThan(long_text.length)
    expect(detail.blocks[0].text).toContain('详情预览已截断')
  })
})
