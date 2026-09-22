import { constants } from 'node:fs'
import { copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { MEMORY_EDIT_LIMIT } from '../shared/memory_types'
import type { MemoryBackup, MemoryBackupDocument, MemoryChange, MemoryCreate, MemoryMutationResult, MemoryRemove } from '../shared/memory_types'
import type { create_memory_service } from './memory_service'
import { hash_memory_file, read_memory_page, validate_memory_path } from './memory_files'

type MemoryService = ReturnType<typeof create_memory_service>
interface Manifest extends Omit<MemoryBackup, 'restorable'> {
  schema: 1; memory_root: string; pre_hash: string; post_hash: string | null
  phase: 'mutation' | 'restore' | 'purge'
}
const valid_id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const valid_hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const digest = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

// 同一服务中的写入与备份操作串行执行；跨进程更新另用指纹复核。
export function create_memory_mutations(service: MemoryService, backup_root: string) {
  let pending = Promise.resolve<unknown>(undefined)
  const locked = <T>(work: () => Promise<T>): Promise<T> => {
    const next = pending.catch(() => undefined).then(work)
    pending = next
    return next
  }
  const backup_path = async (id: string, name = '', allow_missing = false): Promise<string> => {
    if (!valid_id(id)) throw new Error('备份标识无效')
    return validate_memory_path(backup_root, name ? `${id}/${name}` : id, allow_missing)
  }
  const write_synced = async (file: string, bytes: Buffer): Promise<void> => {
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() }
    finally { await handle.close() }
  }
  const write_manifest = async (manifest: Manifest): Promise<void> => {
    const temp_name = `manifest-${randomUUID()}.tmp`
    const temp = await backup_path(manifest.id, temp_name, true)
    try {
      await write_synced(temp, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
      const target = await backup_path(manifest.id, 'manifest.json', true)
      await rename(temp, target)
    } finally { await rm(temp, { force: true }) }
  }
  const load_manifest = async (id: string): Promise<Manifest> => {
    const path = await backup_path(id, 'manifest.json')
    if ((await lstat(path)).size > 64 * 1024) throw new Error('备份清单过大，无法读取')
    const item = JSON.parse(await readFile(path, 'utf8')) as Manifest
    if (item.schema !== 1 || item.id !== id || item.memory_root !== resolve(service.root)
      || typeof item.relative_path !== 'string' || !valid_hash(item.pre_hash)
      || !['save', 'remove'].includes(item.kind) || !['mutation', 'restore', 'purge'].includes(item.phase)
      || !['prepared', 'completed', 'failed', 'uncertain', 'restored'].includes(item.status)
      || !Number.isFinite(Date.parse(item.created_at))
      || (item.kind === 'save' ? !valid_hash(item.post_hash) : item.post_hash !== null)) {
      throw new Error('备份清单无效或不属于当前记忆目录')
    }
    await validate_memory_path(service.root, item.relative_path, true)
    return item
  }
  const source_hash = async (manifest: Manifest): Promise<string | null> => {
    const path = await validate_memory_path(service.root, manifest.relative_path, true)
    try { return await hash_memory_file(path) }
    catch (error) { if (missing(error)) return null; throw error }
  }
  const recover_manifest = async (manifest: Manifest): Promise<void> => {
    if (manifest.status !== 'prepared') return
    // 只核验和更新操作记录，不根据不完整记录覆盖源文件。
    const current = await source_hash(manifest)
    if (manifest.phase === 'restore') {
      manifest.status = current === manifest.pre_hash ? 'restored' : current === manifest.post_hash ? 'completed' : 'uncertain'
    } else {
      manifest.status = current === manifest.post_hash ? 'completed' : current === manifest.pre_hash ? 'failed' : 'uncertain'
    }
    manifest.error = manifest.status === 'uncertain' ? '操作中断后文件状态不明确，已保留备份，未改动源文件' : undefined
    await write_manifest(manifest)
  }
  const summary = async (manifest: Manifest): Promise<MemoryBackup> => {
    let restorable = false
    let error = manifest.error
    if (manifest.status === 'completed') {
      try {
        const original = await backup_path(manifest.id, 'original.bin')
        if (await hash_memory_file(original) !== manifest.pre_hash) error = '备份内容校验失败'
        else if (await source_hash(manifest) !== manifest.post_hash) error = '源文件已发生变化，不能覆盖恢复'
        else restorable = true
      } catch { error = '备份或源文件无法核验，不能恢复' }
    }
    return { id: manifest.id, relative_path: manifest.relative_path, kind: manifest.kind, created_at: manifest.created_at, status: manifest.status, restorable, error }
  }
  const finish_purge = async (id: string): Promise<void> => {
    const directory = await backup_path(id)
    // 只清理由本功能生成的文件；不递归删除未知目录。
    const names = await readdir(directory)
    for (const name of names) {
      if (name !== 'original.bin' && name !== 'manifest.json' && !/^manifest-[a-f0-9-]+\.tmp$/.test(name)) {
        throw new Error('备份目录包含未知文件，已停止清理')
      }
      const path = await backup_path(id, name)
      if (!(await lstat(path)).isFile()) throw new Error('备份目录包含异常文件，已停止清理')
    }
    for (const name of names) {
      if (name !== 'manifest.json') await rm(await backup_path(id, name))
    }
    await rm(await backup_path(id, 'manifest.json', true), { force: true })
    await rmdir(directory)
  }
  const prepare_backup = async (relative_path: string, source: string, pre_hash: string, post_hash: string | null): Promise<Manifest> => {
    const id = randomUUID()
    const directory = await backup_path(id, '', true)
    await mkdir(directory, { recursive: true })
    const original = await backup_path(id, 'original.bin', true)
    await copyFile(source, original, constants.COPYFILE_EXCL)
    const handle = await open(original, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    if (await hash_memory_file(original) !== pre_hash) throw new Error('备份期间文件发生变化，未修改源文件')
    const manifest: Manifest = { schema: 1, id, memory_root: resolve(service.root), relative_path, pre_hash, post_hash,
      kind: post_hash === null ? 'remove' : 'save', created_at: new Date().toISOString(), status: 'prepared', phase: 'mutation' }
    await write_manifest(manifest)
    return manifest
  }
  const verify_request = (input: MemoryRemove): void => {
    if (!input || typeof input.id !== 'string' || !valid_hash(input.expected_version)) throw new Error('记忆操作参数无效')
  }
  const check_version = async (id: string, expected: string): Promise<string> => {
    const file = await service.resolve_file(id)
    if (await hash_memory_file(file.path) !== expected) throw new Error('记忆已被其他操作修改，请保留草稿并重新加载')
    return file.path
  }
  const failed_operation = async (manifest: Manifest): Promise<void> => {
    // 替换成功而清单写入失败时，重新核验能保留实际已完成的操作。
    manifest.status = 'prepared'
    try { await recover_manifest(manifest) } catch { /* 保留磁盘清单供下次核验。 */ }
  }
  const save = (input: MemoryChange): Promise<MemoryMutationResult> => locked(async () => {
    verify_request(input)
    if (typeof input.content !== 'string' || input.content.includes('\0')) throw new Error('记忆正文必须是有效文本')
    if (Buffer.byteLength(input.content, 'utf8') > MEMORY_EDIT_LIMIT) throw new Error('记忆正文超过 2 MiB 编辑上限')
    const doc = await service.read(input.id)
    if (!doc.editable) throw new Error('此文件仅支持只读查看，不能编辑')
    const source = await check_version(input.id, input.expected_version)
    const normalized = doc.newline === 'crlf' ? input.content.replace(/\r?\n/g, '\r\n') : input.content.replace(/\r\n/g, '\n')
    const bytes = Buffer.from(`${doc.has_bom ? '\uFEFF' : ''}${normalized}`, 'utf8')
    if (bytes.length > MEMORY_EDIT_LIMIT) throw new Error('记忆正文超过 2 MiB 编辑上限')
    const post_hash = digest(bytes)
    if (post_hash === input.expected_version) return { id: input.id }
    const manifest = await prepare_backup(doc.file.relative_path, source, input.expected_version, post_hash)
    const temp_relative = `${doc.file.relative_path}.memory-${randomUUID()}.tmp`
    const temp = await validate_memory_path(service.root, temp_relative, true)
    try {
      await write_synced(temp, bytes)
      await check_version(input.id, input.expected_version)
      await rename(temp, await validate_memory_path(service.root, doc.file.relative_path))
      manifest.status = 'completed'
      await write_manifest(manifest)
      return { id: input.id, backup_id: manifest.id }
    } catch (error) { await failed_operation(manifest); throw error }
    finally { await rm(temp, { force: true }) }
  })
  const remove = (input: MemoryRemove): Promise<MemoryMutationResult> => locked(async () => {
    verify_request(input)
    const doc = await service.read(input.id)
    if (!doc.file.readable) throw new Error('此文件不支持删除')
    const source = await check_version(input.id, input.expected_version)
    const manifest = await prepare_backup(doc.file.relative_path, source, input.expected_version, null)
    try {
      const path = await check_version(input.id, input.expected_version)
      await rm(path)
      manifest.status = 'completed'
      await write_manifest(manifest)
      return { id: input.id, backup_id: manifest.id }
    } catch (error) { await failed_operation(manifest); throw error }
  })
  const create = (input: MemoryCreate): Promise<MemoryMutationResult> => locked(async () => {
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || /[\r\n\0]/.test(input.title)
      || typeof input.content !== 'string' || !input.content.trim() || input.content.includes('\0')) throw new Error('请填写有效标题和记忆正文，标题不能超过 200 字符')
    const bytes = Buffer.from(`# ${input.title.trim()}\n\n${input.content.replace(/\r\n/g, '\n').replace(/\n?$/, '\n')}`, 'utf8')
    if (bytes.length > MEMORY_EDIT_LIMIT) throw new Error('记忆正文超过 2 MiB 大小上限')
    const relative_path = `extensions/ad_hoc/notes/${Date.now()}-${randomUUID()}.md`
    const target = await validate_memory_path(service.root, relative_path, true)
    await mkdir(dirname(target), { recursive: true })
    await validate_memory_path(service.root, relative_path, true)
    const temp = await validate_memory_path(service.root, `${relative_path}.memory-${randomUUID()}.tmp`, true)
    try {
      await write_synced(temp, bytes)
      // 硬链接发布不会覆盖碰巧存在的同名文件，完成后删除临时链接。
      await link(temp, await validate_memory_path(service.root, relative_path, true))
    } finally { await rm(temp, { force: true }) }
    const catalog = await service.refresh()
    const item = catalog.files.find(file => file.relative_path === relative_path)
    if (!item) throw new Error('文件已创建，但目录刷新失败，请刷新后查看')
    return { id: item.id }
  })
  const list_backups = (): Promise<MemoryBackup[]> => locked(async () => {
    let ids: string[]
    try {
      // 使用已校验的子路径确认备份根目录及其祖先不是链接。
      await backup_path('00000000-0000-0000-0000-000000000000', '', true)
      ids = await readdir(backup_root)
    } catch (error) { if (missing(error)) return []; throw error }
    const items: MemoryBackup[] = []
    for (const id of ids.filter(valid_id)) {
      try {
        const manifest = await load_manifest(id)
        if (manifest.phase === 'purge') { await finish_purge(id); continue }
        await recover_manifest(manifest)
        items.push(await summary(manifest))
      } catch {
        items.push({ id, relative_path: '无法读取的备份', kind: 'save', created_at: '', status: 'uncertain', restorable: false, error: '备份清单或文件异常，已保留原始数据' })
      }
    }
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at))
  })
  const read_backup = (id: string, offset = 0): Promise<MemoryBackupDocument> => locked(async () => {
    const manifest = await load_manifest(id)
    if (manifest.phase === 'purge') throw new Error('备份正在删除，无法读取')
    const original = await backup_path(id, 'original.bin')
    if (await hash_memory_file(original) !== manifest.pre_hash) throw new Error('备份内容校验失败')
    const page = await read_memory_page(original, offset)
    return { backup: await summary(manifest), content: page.content, offset: page.offset, next_offset: page.next_offset }
  })
  const restore = (id: string): Promise<MemoryMutationResult> => locked(async () => {
    const manifest = await load_manifest(id)
    await recover_manifest(manifest)
    if (manifest.status !== 'completed' || manifest.phase === 'purge') throw new Error('当前备份状态不支持恢复')
    const original = await backup_path(id, 'original.bin')
    if (await hash_memory_file(original) !== manifest.pre_hash) throw new Error('备份内容校验失败')
    if (await source_hash(manifest) !== manifest.post_hash) throw new Error('源文件已发生变化或重新存在，拒绝覆盖恢复')
    const target = await validate_memory_path(service.root, manifest.relative_path, true)
    await mkdir(dirname(target), { recursive: true })
    const temp = await validate_memory_path(service.root, `${manifest.relative_path}.memory-${randomUUID()}.tmp`, true)
    try {
      await copyFile(original, temp, constants.COPYFILE_EXCL)
      const handle = await open(temp, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      if (await hash_memory_file(temp) !== manifest.pre_hash) throw new Error('恢复文件校验失败')
      manifest.phase = 'restore'; manifest.status = 'prepared'; await write_manifest(manifest)
      if (await source_hash(manifest) !== manifest.post_hash) throw new Error('恢复期间源文件发生变化，已停止恢复')
      const checked_target = await validate_memory_path(service.root, manifest.relative_path, true)
      if (manifest.kind === 'remove') await link(temp, checked_target)
      else await rename(temp, checked_target)
      manifest.status = 'restored'; manifest.error = undefined; await write_manifest(manifest)
      const catalog = await service.refresh()
      return { id: catalog.files.find(file => file.relative_path === manifest.relative_path)?.id || '', backup_id: id }
    } catch (error) { await failed_operation(manifest); throw error }
    finally { await rm(temp, { force: true }) }
  })
  const remove_backup = (id: string): Promise<void> => locked(async () => {
    let manifest: Manifest | undefined
    try { manifest = await load_manifest(id) }
    catch { /* 用户明确选择异常备份时，仍只允许清理该目录中的固定备份文件。 */ }
    if (manifest) {
      manifest.phase = 'purge'
      await write_manifest(manifest)
    }
    await finish_purge(id)
  })
  return { create, save, remove, list_backups, read_backup, restore, remove_backup }
}
