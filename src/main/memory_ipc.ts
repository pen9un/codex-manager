import { ipcMain } from 'electron'
import type { create_memory_service } from './memory_service'
import type { create_memory_mutations } from './memory_mutations'
import type { OperationResult } from '../shared/types'
import type { MemoryChange, MemoryCreate, MemoryRemove } from '../shared/memory_types'

const result = async <T>(work: () => Promise<T>): Promise<OperationResult<T>> => {
  try { return { success: true, data: await work() } }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const messages: Record<string, string> = {
      ENOENT: '文件已不存在，请刷新后重试', EACCES: '没有访问文件的权限，未完成操作',
      EPERM: '文件可能被占用或没有访问权限，请检查后重试', EBUSY: '文件正在被占用，请稍后重试',
      EEXIST: '目标文件已存在，未覆盖原文件', ENOTDIR: '目录路径被文件占用，请检查后重试',
      ENOSPC: '磁盘空间不足，未完成操作',
    }
    return { success: false, error: code && messages[code] || (error instanceof SyntaxError ? '备份记录格式无效' : error instanceof Error ? error.message : '记忆操作失败') }
  }
}

export function register_memory_ipc(
  service: ReturnType<typeof create_memory_service>,
  mutations: ReturnType<typeof create_memory_mutations>,
  confirm_write: (action: string) => Promise<void>,
): void {
  ipcMain.handle('memories:list', () => result(() => service.list()))
  ipcMain.handle('memories:refresh', () => result(() => service.refresh()))
  ipcMain.handle('memories:search', (_event, query, category) => result(() => service.search(query, category)))
  ipcMain.handle('memories:read', (_event, id, offset, expected_version) => result(() => service.read(id, offset, expected_version)))
  const change_valid = (input: MemoryRemove): void => {
    if (!input || typeof input.id !== 'string' || typeof input.expected_version !== 'string') throw new Error('记忆操作参数无效')
  }
  ipcMain.handle('memories:create', (_event, input: MemoryCreate) => result(async () => {
    if (!input || typeof input.title !== 'string' || typeof input.content !== 'string') throw new Error('新增记忆参数无效')
    await confirm_write('新增'); return mutations.create(input)
  }))
  ipcMain.handle('memories:save', (_event, input: MemoryChange) => result(async () => {
    change_valid(input)
    if (typeof input.content !== 'string') throw new Error('记忆正文必须是文本')
    await confirm_write('保存'); return mutations.save(input)
  }))
  ipcMain.handle('memories:remove', (_event, input: MemoryRemove) => result(async () => {
    change_valid(input); await confirm_write('删除'); return mutations.remove(input)
  }))
  ipcMain.handle('memories:list_backups', () => result(() => mutations.list_backups()))
  ipcMain.handle('memories:read_backup', (_event, id, offset) => result(() => mutations.read_backup(id, offset)))
  ipcMain.handle('memories:restore', (_event, id) => result(async () => {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('备份标识无效')
    await confirm_write('恢复'); return mutations.restore(id)
  }))
  ipcMain.handle('memories:remove_backup', (_event, id) => result(() => mutations.remove_backup(id)))
}
