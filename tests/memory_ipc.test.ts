import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_memory_service } from '../src/main/memory_service'
import { create_memory_mutations } from '../src/main/memory_mutations'
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => Promise<any>>())
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (...args: any[]) => Promise<any>) => handlers.set(name, callback) } }))
import { register_memory_ipc } from '../src/main/memory_ipc'

describe('记忆 IPC 边界', () => {
  it('真实服务只经白名单调用，取消写入和非法请求均保留源文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-ipc-'))
    try {
      await mkdir(join(root, 'memories'))
      const source = join(root, 'memories', 'MEMORY.md')
      await writeFile(source, '# 原始记忆\n')
      const service = create_memory_service({ codex_home: root })
      const mutations = create_memory_mutations(service, join(root, 'manager', 'backups'))
      let cancel = true
      register_memory_ipc(service, mutations, async () => { if (cancel) throw new Error('已取消操作') })
      const invoke = (name: string, ...args: unknown[]) => handlers.get(`memories:${name}`)!({}, ...args)
      expect(handlers.size).toBe(11)
      const list = await invoke('list')
      expect(list.success).toBe(true)
      const doc = (await invoke('read', list.data.files[0].id)).data
      expect(await invoke('save', { id: doc.file.id, expected_version: doc.version, content: '新内容' })).toMatchObject({ success: false, error: '已取消操作' })
      expect(await readFile(source, 'utf8')).toBe('# 原始记忆\n')
      cancel = false
      for (const name of ['save', 'remove', 'create']) expect((await invoke(name, null)).success).toBe(false)
      expect((await invoke('read', source)).success).toBe(false)
      expect((await invoke('read', doc.file.id, -1)).success).toBe(false)
      expect((await invoke('search', {}, 'all')).success).toBe(false)
      const result = await invoke('save', { id: doc.file.id, expected_version: doc.version, content: '保存结果' })
      expect(result.success).toBe(true)
      expect(await readFile(source, 'utf8')).toBe('保存结果')
      expect((await invoke('list_backups')).data).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
