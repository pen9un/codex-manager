import { createReadStream } from 'node:fs'
import { lstat, open, readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, extname, join, resolve } from 'node:path'
import * as toml from '@iarna/toml'
import { codexHome } from './codex'
import { hash_memory_file, read_memory_page, validate_memory_path } from './memory_files'
import { MEMORY_CATEGORIES, MEMORY_EDIT_LIMIT, type MemoryCatalog, type MemoryCategory, type MemoryConfig, type MemoryDocument, type MemoryEntry, type MemorySearchResult } from '../shared/memory_types'

const text_extensions = new Set(['.md', '.markdown', '.txt'])
const binary_extensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.db', '.sqlite', '.sqlite3', '.woff', '.woff2', '.mp3', '.mp4'])
const config_keys = ['features.memories', 'memories.generate_memories', 'memories.use_memories', 'memories.disable_on_external_context', 'memories.no_memories_if_mcp_or_web_search']
const error_message = (error: unknown): string => error instanceof Error ? error.message : '未知读取错误'

function memory_category(relative_path: string): MemoryCategory {
  const lower = relative_path.toLowerCase()
  if (lower === 'memory_summary.md') return 'summary'
  if (lower === 'memory.md') return 'long_term'
  if (lower === 'raw_memories.md') return 'raw'
  if (lower.startsWith('rollout_summaries/')) return 'rollouts'
  if (lower.startsWith('skills/')) return 'skills'
  if (lower.startsWith('extensions/ad_hoc/notes/') || lower.startsWith('notes/')) return 'notes'
  return 'other'
}

async function read_config(codex_home: string): Promise<MemoryConfig> {
  const values: MemoryConfig['values'] = config_keys.map(key => ({ key, value: null }))
  try {
    const config = toml.parse(await readFile(join(codex_home, 'config.toml'), 'utf8'))
    for (const value of values) {
      const [section, key] = value.key.split('.')
      const group = config[section]
      if (group && typeof group === 'object' && !Array.isArray(group)) {
        const setting = (group as Record<string, unknown>)[key]
        if (typeof setting === 'boolean') value.value = setting
      }
    }
    return { values }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { values }
    const line = (error as { line?: number }).line
    return { values, error: Number.isInteger(line) ? `记忆配置格式错误（第 ${line! + 1} 行）` : '记忆配置读取失败或格式无效' }
  }
}

async function read_excerpt(file: string): Promise<{ text: string; binary: boolean }> {
  const handle = await open(file, 'r')
  try {
    const size = (await handle.stat()).size
    const buffer = Buffer.alloc(Math.min(size, 8192))
    const { bytesRead: bytes_read } = await handle.read(buffer, 0, buffer.length, 0)
    const sample = buffer.subarray(0, bytes_read)
    if (sample.includes(0)) return { text: '', binary: true }
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: bytes_read < size }), binary: false } }
    catch { throw new Error('文件包含损坏的 UTF-8 文本') }
  } finally { await handle.close() }
}

/** 目录索引仅保留元数据与小片段，全文按用户操作流式读取。 */
export function create_memory_service({ codex_home = codexHome() }: { codex_home?: string } = {}) {
  const root = resolve(codex_home, 'memories')
  let catalog: MemoryCatalog | undefined
  let known_files = new Map<string, MemoryEntry>()

  async function refresh(): Promise<MemoryCatalog> {
    const next: MemoryCatalog = { root, exists: false, files: [], warnings: [], config: await read_config(codex_home) }
    try {
      await validate_memory_path(root, '', true)
      next.exists = (await lstat(root)).isDirectory()
      if (!next.exists) next.warnings.push('记忆根路径不是目录')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') next.warnings.push(`记忆目录不可访问：${error_message(error)}`)
    }
    async function visit(relative_dir: string): Promise<void> {
      try {
        const directory = await validate_memory_path(root, relative_dir)
        for (const item of await readdir(directory, { withFileTypes: true })) {
          if (item.name === '.git' || /^~\$|~$|\.(tmp|temp|swp|swo|bak)$/i.test(item.name) || ['tmp', 'temp', '.tmp', '.temp'].includes(item.name.toLowerCase()) || item.isSymbolicLink()) continue
          const relative_path = relative_dir ? `${relative_dir}/${item.name}` : item.name
          if (item.isDirectory()) { await visit(relative_path); continue }
          if (!item.isFile() || binary_extensions.has(extname(item.name).toLowerCase())) continue
          try {
            const path = await validate_memory_path(root, relative_path)
            const info = await stat(path)
            const entry: MemoryEntry = {
              id: createHash('sha256').update(relative_path).digest('hex'), relative_path,
              title: basename(item.name, extname(item.name)), excerpt: '', category: memory_category(relative_path),
              size: info.size, modified_at: info.mtime.toISOString(), readable: text_extensions.has(extname(item.name).toLowerCase()),
            }
            try {
              const sample = await read_excerpt(path)
              if (sample.binary) continue
              if (entry.readable) {
                const lines = sample.text.split(/\r?\n/).filter(line => line.trim())
                entry.title = (lines.find(line => /^#{1,6}\s/.test(line))?.replace(/^#{1,6}\s+/, '').trim() || entry.title).slice(0, 160)
                entry.excerpt = lines.filter(line => !/^#{1,6}\s/.test(line)).join(' ').slice(0, 240)
              }
            } catch (error) {
              if (!entry.readable && error_message(error).includes('UTF-8')) continue
              entry.readable = false
              entry.read_error = error_message(error)
            }
            next.files.push(entry)
          } catch (error) { next.warnings.push(`${relative_path}：${error_message(error)}`) }
        }
      } catch (error) { next.warnings.push(`${relative_dir || '记忆目录'}：${error_message(error)}`) }
    }
    if (next.exists) await visit('')
    next.files.sort((left, right) => right.modified_at.localeCompare(left.modified_at) || left.relative_path.localeCompare(right.relative_path))
    known_files = new Map(next.files.map(file => [file.id, file]))
    catalog = next
    return next
  }

  async function list(): Promise<MemoryCatalog> { return catalog ?? refresh() }

  async function resolve_file(id: string): Promise<{ path: string; relative_path: string }> {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('记忆文件标识参数无效')
    await list()
    const entry = known_files.get(id)
    if (!entry) throw new Error('未知记忆文件，请刷新目录后重试')
    const path = await validate_memory_path(root, entry.relative_path)
    if (!(await lstat(path)).isFile()) throw new Error('记忆文件已不是普通文件')
    return { path, relative_path: entry.relative_path }
  }

  async function read(id: string, offset = 0, expected_version?: string): Promise<MemoryDocument> {
    const { path } = await resolve_file(id)
    const entry = known_files.get(id)!
    if (!entry.readable) throw new Error(entry.read_error || '此文件仅支持查看元数据')
    if (offset > 0 && !expected_version) throw new Error('继续读取必须提供文件版本')
    const version = await hash_memory_file(path)
    if (expected_version !== undefined && version !== expected_version) throw new Error('记忆文件已经变更，请从第一页重新读取')
    const page = await read_memory_page(path, offset)
    await validate_memory_path(root, entry.relative_path)
    const info = await stat(path)
    if (await hash_memory_file(path) !== version) throw new Error('读取期间记忆文件已变更，请重新读取')
    return { file: { ...entry, size: info.size, modified_at: info.mtime.toISOString() }, ...page, version, editable: info.size <= MEMORY_EDIT_LIMIT, warning: info.size > MEMORY_EDIT_LIMIT ? '文件超过 2 MiB，按页只读显示' : undefined }
  }

  async function search(query: string, category: MemoryCategory | 'all' = 'all'): Promise<MemorySearchResult> {
    if (typeof query !== 'string' || query.length > 500) throw new Error('搜索参数无效，查询词必须为不超过 500 个字符的字符串')
    if (typeof category !== 'string' || !Object.prototype.hasOwnProperty.call(MEMORY_CATEGORIES, category)) throw new Error('搜索分类参数无效')
    const current = await list()
    const result: MemorySearchResult = { files: [], warnings: [...current.warnings] }
    const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
    for (const entry of current.files) {
      if (category !== 'all' && entry.category !== category) continue
      const metadata = `${entry.title}\n${entry.relative_path}`
      const metadata_match = matcher.exec(metadata)
      const metadata_excerpt = metadata_match ? metadata.slice(Math.max(0, metadata_match.index - 80), metadata_match.index + metadata_match[0].length + 120) : undefined
      if (!entry.readable) {
        if (entry.read_error) result.warnings.push(`${entry.relative_path}：${entry.read_error}`)
        if (metadata_excerpt !== undefined) result.files.push({ ...entry, excerpt: metadata_excerpt })
        continue
      }
      try {
        const { path } = await resolve_file(entry.id)
        const decoder = new TextDecoder('utf-8', { fatal: true })
        let tail = ''
        let excerpt: string | undefined
        let pending_after = 0
        function inspect_chunk(chunk: string): void {
          if (chunk.includes('\0')) throw new Error('文件包含二进制内容')
          if (excerpt !== undefined) {
            excerpt += chunk.slice(0, pending_after)
            pending_after = Math.max(0, pending_after - chunk.length)
            return
          }
          const text = tail + chunk
          const match = matcher.exec(text)
          if (match) {
            const end = match.index + match[0].length + 120
            excerpt = text.slice(Math.max(0, match.index - 80), end)
            pending_after = Math.max(0, end - text.length)
          }
          tail = text.slice(-(query.length + 80))
        }
        for await (const chunk of createReadStream(path)) {
          inspect_chunk(decoder.decode(chunk as Buffer, { stream: true }))
        }
        inspect_chunk(decoder.decode())
        if (excerpt !== undefined || metadata_excerpt !== undefined) result.files.push({ ...entry, excerpt: excerpt ?? metadata_excerpt! })
      } catch (error) {
        result.warnings.push(`${entry.relative_path}：全文搜索失败，${error_message(error)}`)
        if (metadata_excerpt !== undefined) result.files.push({ ...entry, excerpt: metadata_excerpt })
      }
    }
    return result
  }

  return { root, list, refresh, search, read, resolve_file }
}
