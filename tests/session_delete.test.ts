import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, toNamespacedPath } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionDeletionService } from '../src/main/session_deletion'
import { parseSessionFile } from '../src/main/session_parser'
import type { SessionFileRef } from '../src/shared/types'

const roots: string[] = []

function block_id(path: string, line: number): string {
  const prefix = createHash('sha256').update(path).digest('hex').slice(0, 16)
  return `${prefix}-block-${line}`
}

function record(type: string, payload: Record<string, unknown>, timestamp = '2026-09-19T10:00:00.000Z'): string {
  return JSON.stringify({ timestamp, type, payload })
}

async function fixture(newline = '\n'): Promise<{ root: string; file: string; ref: SessionFileRef; lines: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'codex-manager-delete-')); roots.push(root)
  const file = join(root, 'rollout-session.jsonl')
  const lines = [
    record('session_meta', { id: 'session-1', cwd: 'C:/workspace/demo' }),
    record('developer', { text: '全局开发者说明' }),
    record('turn_context', { turn_id: 'turn-1' }),
    record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第一条问题' }] }),
    record('response_item', { type: 'function_call', call_id: 'call-1', name: 'shell', arguments: 'dir' }),
    record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '第一条回答' }] }),
    record('event_msg', { type: 'agent_message', message: '第一条回答' }),
    record('turn_context', { turn_id: 'turn-2' }),
    record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第二条问题' }] }),
    record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '第二条回答' }] }),
    record('response_item', { type: 'function_call_output', call_id: 'call-1', output: '工具延迟结果' }),
    record('event_msg', { type: 'turn_completed', turn_id: 'turn-1' }),
  ]
  await writeFile(file, lines.join(newline) + newline, 'utf8')
  return { root, file, ref: { id: 'session-1', path: file, archived: false }, lines }
}

function service(refs: SessionFileRef[], root: string) {
  return createSessionDeletionService({ resolveFiles: async id => id === 'session-1' ? refs : [], backupRoot: join(root, 'backups') })
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('会话消息安全删除', () => {
  it('普通路径与扩展路径指向同一文件时只备份替换一次', async () => {
    const item = await fixture(); const original = await readFile(item.file)
    const deletion = service([item.ref, { ...item.ref, path: toNamespacedPath(item.file) }], item.root)
    const selected = [block_id(item.file, 4)]
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: selected })
    expect(preview.fileCount).toBe(1)
    expect(preview.userBlockCount).toBe(1)
    const result = await deletion.delete({ sessionId: 'session-1', selectedBlockIds: selected, previewToken: preview.previewToken })
    expect(await readFile(item.file, 'utf8')).not.toContain('第一条问题')
    await deletion.restore(result.operationId)
    expect(await readFile(item.file)).toEqual(original)
  })
  it('选中用户指令时删除完整轮次、工具记录与事件镜像并保留其他内容', async () => {
    const item = await fixture(); const deletion = service([item.ref], item.root)
    const selected = block_id(item.file, 4)
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [selected] })
    expect(preview.turnIds).toEqual(['turn-1'])
    expect(preview.userBlockCount).toBe(1)
    expect(preview.assistantBlockCount).toBe(1)
    expect(preview.toolRecordCount).toBe(2)
    expect(preview.rawRecordCount).toBeGreaterThanOrEqual(7)
    const result = await deletion.delete({ sessionId: 'session-1', selectedBlockIds: [selected], previewToken: preview.previewToken })
    expect(result.deletedTurnCount).toBe(1)
    const text = await readFile(item.file, 'utf8')
    expect(text).toContain('第二条问题')
    expect(text).toContain('全局开发者说明')
    expect(text).not.toContain('第一条问题')
    expect(text).not.toContain('第一条回答')
    expect(text).not.toContain('工具延迟结果')
    expect(text).toContain('session-1')
  })

  it('选中 AI 回复也展开为完整轮次，并保留 CRLF 与中文字节内容', async () => {
    const item = await fixture('\r\n'); const deletion = service([item.ref], item.root)
    const parsed = await parseSessionFile(item.ref); const assistant = parsed.blocks.find(block => block.role === 'assistant' && block.text.includes('第一条回答'))
    expect(assistant).toBeTruthy()
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [assistant!.id] })
    expect(preview.turnIds).toEqual(['turn-1'])
    await deletion.delete({ sessionId: 'session-1', selectedBlockIds: [assistant!.id], previewToken: preview.previewToken })
    const bytes = await readFile(item.file)
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(true)
    expect(bytes.toString('utf8')).toContain('第二条问题')
    expect(bytes.toString('utf8')).not.toContain('第一条回答')
  })

  it('多文件会话先完整备份，删除后可撤销恢复原始文件', async () => {
    const item = await fixture(); const second = join(item.root, 'rollout-session-2.jsonl')
    await writeFile(second, [record('session_meta', { id: 'session-1' }), record('turn_context', { turn_id: 'turn-3' }), record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第三条问题' }] })].join('\n') + '\n')
    const refs = [item.ref, { id: 'session-1', path: second, archived: false }]
    const deletion = service(refs, item.root); const original = await Promise.all(refs.map(ref => readFile(ref.path)))
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)] })
    const result = await deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)], previewToken: preview.previewToken })
    expect((await deletion.backups('session-1')).find(item => item.id === result.backupId)?.restorable).toBe(true)
    await deletion.restore(result.operationId)
    expect(await readFile(item.file)).toEqual(original[0])
    expect(await readFile(second)).toEqual(original[1])
  })

  it('多文件替换中途失败时自动回滚已经替换的文件', async () => {
    const item = await fixture(); const second = join(item.root, 'rollout-session-rollback.jsonl')
    await writeFile(second, [record('session_meta', { id: 'session-1' }), record('turn_context', { turn_id: 'turn-1' }), record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '跨文件回答' }] })].join('\n') + '\n')
    const refs = [item.ref, { id: 'session-1', path: second, archived: false }]; const original = await readFile(item.file)
    let replace_count = 0
    const deletion = createSessionDeletionService({
      resolveFiles: async id => id === 'session-1' ? refs : [],
      backupRoot: join(item.root, 'backups'),
      replaceFile: async (from, to) => {
        if (String(from).includes('.codex-delete-') && ++replace_count === 2) throw new Error('注入替换失败')
        return rename(from, to)
      },
    })
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)] })
    await expect(deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)], previewToken: preview.previewToken })).rejects.toThrow()
    expect(replace_count).toBeGreaterThanOrEqual(2)
    expect(await readFile(item.file)).toEqual(original)
  })

  it('文件变化后拒绝确认删除，损坏记录无法安全归属时拒绝删除', async () => {
    const item = await fixture(); const deletion = service([item.ref], item.root)
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)] })
    await writeFile(item.file, (await readFile(item.file, 'utf8')) + 'changed\n')
    await expect(deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)], previewToken: preview.previewToken })).rejects.toThrow('文件已发生变化')

    const broken = await fixture(); const brokenContent = (await readFile(broken.file, 'utf8')).split('\n'); brokenContent.splice(5, 0, '{损坏记录'); await writeFile(broken.file, brokenContent.join('\n'))
    const brokenDeletion = service([broken.ref], broken.root)
    await expect(brokenDeletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(broken.file, 4)] })).rejects.toThrow('无法安全归属')
  })

  it('删除全部消息后保留空 Session 文件，备份恢复检测到新内容时拒绝覆盖', async () => {
    const item = await fixture(); const deletion = service([item.ref], item.root)
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4), block_id(item.file, 9)] })
    await deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4), block_id(item.file, 9)], previewToken: preview.previewToken })
    const remaining = await readFile(item.file, 'utf8')
    expect(remaining).toContain('session-1')
    expect(remaining).not.toContain('第一条问题')
    expect(remaining).not.toContain('第二条问题')
    const backups = await deletion.backups('session-1'); expect(backups).toHaveLength(1)
    await writeFile(item.file, remaining + 'new-content\n')
    await expect(deletion.restore(backups[0].id)).rejects.toThrow('删除后文件已发生变化')
  })

  it('备份管理可以删除指定备份目录', async () => {
    const item = await fixture(); const deletion = service([item.ref], item.root)
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)] })
    const result = await deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)], previewToken: preview.previewToken })
    await deletion.removeBackup(result.backupId)
    expect(await deletion.backups('session-1')).toEqual([])
    expect(JSON.parse(await readFile(join(item.root, 'backups', result.backupId, 'manifest.json'), 'utf8')).status).toBe('purged')
  })

  it('读取备份列表时会恢复崩溃后遗留的 prepared 删除事务', async () => {
    const item = await fixture(); const original = await readFile(item.file); const deletion = service([item.ref], item.root)
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)] })
    const result = await deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)], previewToken: preview.previewToken })
    const manifest_path = join(item.root, 'backups', result.backupId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifest_path, 'utf8'))
    manifest.status = 'prepared'
    manifest.files[0].state = 'replaced'
    await writeFile(manifest_path, JSON.stringify(manifest), 'utf8')
    await deletion.backups('session-1')
    expect(await readFile(item.file)).toEqual(original)
    expect(JSON.parse(await readFile(manifest_path, 'utf8')).status).toBe('rolled_back')
  })

  it('替换后检测到外部新内容时不覆盖现场', async () => {
    const item = await fixture(); const deletion = createSessionDeletionService({
      resolveFiles: async id => id === 'session-1' ? [item.ref] : [],
      backupRoot: join(item.root, 'backups'),
      replaceFile: async (from, to) => { await rename(from, to); await writeFile(to, (await readFile(to, 'utf8')) + '外部新内容\n', 'utf8') },
    })
    const preview = await deletion.preview({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)] })
    await expect(deletion.delete({ sessionId: 'session-1', selectedBlockIds: [block_id(item.file, 4)], previewToken: preview.previewToken })).rejects.toThrow('删除过程中发生变化')
    expect(await readFile(item.file, 'utf8')).toContain('外部新内容')
  })
})

