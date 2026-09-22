import type { OperationResult } from './types'

export const MEMORY_EDIT_LIMIT = 2 * 1024 * 1024
export const MEMORY_CATEGORIES = {
  all: '全部记忆', summary: '记忆摘要', long_term: '长期记忆', raw: '原始记忆',
  rollouts: '会话总结', skills: '记忆技能', notes: '人工补充', other: '其他文档',
} as const
export type MemoryCategory = Exclude<keyof typeof MEMORY_CATEGORIES, 'all'>
export interface MemoryEntry {
  id: string; relative_path: string; title: string; excerpt: string; category: MemoryCategory
  size: number; modified_at: string; readable: boolean; read_error?: string
}
export interface MemoryConfig {
  values: { key: string; value: boolean | null }[]; error?: string
}
export interface MemoryCatalog {
  root: string; exists: boolean; files: MemoryEntry[]; warnings: string[]; config: MemoryConfig
}
export interface MemoryDocument {
  file: MemoryEntry; content: string; version: string; offset: number; next_offset?: number
  editable: boolean; has_bom: boolean; newline: 'lf' | 'crlf'; warning?: string
}
export interface MemorySearchResult { files: MemoryEntry[]; warnings: string[] }
export interface MemoryChange { id: string; expected_version: string; content: string }
export interface MemoryRemove { id: string; expected_version: string }
export interface MemoryCreate { title: string; content: string }
export type MemoryBackupStatus = 'prepared' | 'completed' | 'failed' | 'uncertain' | 'restored'
export interface MemoryBackup {
  id: string; relative_path: string; kind: 'save' | 'remove'; created_at: string
  status: MemoryBackupStatus; restorable: boolean; error?: string
}
export interface MemoryBackupDocument { backup: MemoryBackup; content: string; offset: number; next_offset?: number }
export interface MemoryMutationResult { id: string; backup_id?: string }
export interface MemoryApi {
  list(): Promise<OperationResult<MemoryCatalog>>
  refresh(): Promise<OperationResult<MemoryCatalog>>
  search(query: string, category?: keyof typeof MEMORY_CATEGORIES): Promise<OperationResult<MemorySearchResult>>
  read(id: string, offset?: number, expected_version?: string): Promise<OperationResult<MemoryDocument>>
  create(input: MemoryCreate): Promise<OperationResult<MemoryMutationResult>>
  save(input: MemoryChange): Promise<OperationResult<MemoryMutationResult>>
  remove(input: MemoryRemove): Promise<OperationResult<MemoryMutationResult>>
  list_backups(): Promise<OperationResult<MemoryBackup[]>>
  read_backup(id: string, offset?: number): Promise<OperationResult<MemoryBackupDocument>>
  restore(id: string): Promise<OperationResult<MemoryMutationResult>>
  remove_backup(id: string): Promise<OperationResult<void>>
}
