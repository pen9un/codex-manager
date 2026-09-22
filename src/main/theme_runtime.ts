import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ThemeBackup, ThemeRuntimeStatus } from '../shared/theme_runtime'
import { connect_codex_theme, type ThemeConnection } from './theme_connection'
import { build_skin_payload, load_skin } from './themes'

interface Snapshot { skin_id: string | null; native_classes: string[]; attributes: Record<string, string | null>; variables: Record<string, string> }
interface BackupFile { id: string; created_at: string; name: string; theme_name?: string; windows: number; schema: 1; snapshots: Snapshot[] }
const variable_pattern = /^(--(color|theme|sidebar|background|foreground|font)-[a-zA-Z0-9-]+|color-scheme|font-family)$/

export function validate_theme_snapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw Error('主题快照无效')
  const snapshot = value as Snapshot
  if (snapshot.skin_id !== null && (typeof snapshot.skin_id !== 'string' || !/^[a-z0-9-]+$/.test(snapshot.skin_id))) throw Error('主题快照标识无效')
  if (!Array.isArray(snapshot.native_classes) || snapshot.native_classes.length > 2 || snapshot.native_classes.some(value => !['light', 'dark'].includes(value))) throw Error('主题快照外观模式无效')
  if (!snapshot.attributes || !snapshot.variables || typeof snapshot.attributes !== 'object' || typeof snapshot.variables !== 'object') throw Error('主题快照内容无效')
  if (Object.entries(snapshot.attributes).some(([key, value]) => !['data-theme', 'data-appearance', 'data-color-mode'].includes(key) || value !== null && (typeof value !== 'string' || value.length > 128))) throw Error('主题快照包含不允许恢复的属性')
  const variables = Object.entries(snapshot.variables)
  if (variables.length > 256 || variables.some(([key, value]) => !variable_pattern.test(key) || typeof value !== 'string' || value.length > 2048 || /url\s*\(|expression\s*\(|[{};]/i.test(value))) throw Error('主题快照包含不允许恢复的样式')
  return snapshot
}

const capture_expression = `(() => {
  const root=document.documentElement, state=window.__CODEX_DREAM_SKIN_STATE__;
  const attributes=Object.fromEntries(['data-theme','data-appearance','data-color-mode'].map(key=>[key,root.getAttribute(key)]));
  const variables=Object.fromEntries([...root.style].filter(key=>/^(--(color|theme|sidebar|background|foreground|font)-|color-scheme$|font-family$)/.test(key)).map(key=>[key,root.style.getPropertyValue(key)]));
  return {skin_id:state?.themeId||null,native_classes:['light','dark'].filter(value=>root.classList.contains(value)),attributes,variables};
})()`
const remove_expression = `(() => { const state=window.__CODEX_DREAM_SKIN_STATE__; if(state?.cleanup)state.cleanup(); return !window.__CODEX_DREAM_SKIN_STATE__ && !window.__CODEX_ORIGINAL_THEME_STATE__ && !document.getElementById('codex-dream-skin-style') && !document.getElementById('codex-original-theme-style'); })()`

export class ThemeRuntime {
  private queue: Promise<unknown> = Promise.resolve()
  private active_id: string | null = null
  private last_error = ''
  private motion_enabled = true

  constructor(private readonly directory: string, private readonly connect = connect_codex_theme, private readonly resources = join(__dirname, '../../resources')) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.queue.catch(() => undefined).then(work)
    this.queue = operation
    return operation
  }

  private async json_write(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temporary, join(this.directory, name))
  }

  private async read_index(): Promise<Array<Omit<ThemeBackup, 'available' | 'unavailable_reason'> & Partial<Pick<ThemeBackup, 'available' | 'unavailable_reason'>>>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.directory, 'index.json'), 'utf8'))
      if (!Array.isArray(parsed) || parsed.some(entry => {
        if (!entry || typeof entry !== 'object') return true
        const item = entry as Record<string, unknown>
        return typeof item.id !== 'string' || typeof item.created_at !== 'string' || typeof item.name !== 'string' ||
          !Number.isInteger(item.windows) || (item.windows as number) < 0 ||
          item.theme_name !== undefined && (typeof item.theme_name !== 'string' || item.theme_name.length > 8192) ||
          item.available !== undefined && typeof item.available !== 'boolean' ||
          item.unavailable_reason !== undefined && typeof item.unavailable_reason !== 'string'
      })) throw Error('invalid')
      return parsed as Array<Omit<ThemeBackup, 'available' | 'unavailable_reason'>>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw Error('主题备份索引无法读取，未覆盖原文件')
    }
  }

  private async read_backup_file(id: string): Promise<BackupFile> {
    const file = join(this.directory, `${id}.json`)
    let information
    try { information = await stat(file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('备份文件缺失'); throw Error('备份文件无法读取') }
    if (!information.isFile() || information.size <= 0 || information.size > 1024 * 1024) throw Error('主题备份大小超出限制')
    let backup: BackupFile
    try { backup = JSON.parse(await readFile(file, 'utf8')) }
    catch { throw Error('主题备份内容损坏') }
    if (backup.schema !== 1 || !Array.isArray(backup.snapshots) || !backup.snapshots.length || backup.snapshots.length > 64) throw Error('主题备份格式无效')
    backup.snapshots.forEach(validate_theme_snapshot)
    return backup
  }

  private async read_backups(): Promise<ThemeBackup[]> {
    const entries = await this.read_index()
    return Promise.all(entries.map(async entry => {
      const base: ThemeBackup = {
        id: entry.id, created_at: entry.created_at, name: entry.name, windows: entry.windows,
        available: true, theme_name: entry.theme_name || '无法识别的主题',
      }
      try {
        if (!/^[0-9a-f-]{36}$/.test(base.id)) throw Error('备份标识无效')
        const backup = await this.read_backup_file(base.id)
        const saved_name = typeof backup.theme_name === 'string' && backup.theme_name.length <= 8192 ? backup.theme_name : undefined
        base.theme_name = saved_name || await this.snapshot_theme_name(backup.snapshots)
        for (const snapshot of backup.snapshots) if (snapshot.skin_id) await load_skin(snapshot.skin_id, join(this.resources, 'skins'))
        return base
      } catch (error) {
        return { ...base, available: false, unavailable_reason: error instanceof Error ? error.message : '主题备份不可用' }
      }
    }))
  }

  private async snapshot_theme_name(snapshots: Snapshot[]): Promise<string> {
    const names = await Promise.all([...new Set(snapshots.map(snapshot => snapshot.skin_id))].map(async id => {
      if (!id) return 'Codex 原生外观'
      try { return (await load_skin(id, join(this.resources, 'skins'))).name }
      catch { return `无法读取主题（${id}）` }
    }))
    return names.join(' / ')
  }

  private async capture(connections: ThemeConnection[]): Promise<Snapshot[]> {
    const snapshots: Snapshot[] = []
    for (const connection of connections) {
      const snapshot = validate_theme_snapshot(await connection.evaluate<Snapshot>(capture_expression))
      if (snapshot.skin_id) await load_skin(snapshot.skin_id, join(this.resources, 'skins')).catch(() => { throw Error('检测到旧版或外部主题，请正常退出并重新启动 Codex，确认恢复原生外观后再应用') })
      snapshots.push(snapshot)
    }
    return snapshots
  }

  private async persist_backup(snapshots: Snapshot[], name: string): Promise<ThemeBackup | null> {
    // 内置主题可直接重新应用；混合窗口仍保存完整快照，维持原生窗口的恢复对应关系。
    if (snapshots.every(snapshot => snapshot.skin_id !== null)) return null
    const backups = await this.read_index()
    // 比较恢复所需的全部内容，不能只按主题ID去重而丢失明暗模式或窗口差异。
    const signature = (items: Snapshot[]): string => JSON.stringify(items.map(item => ({
      skin_id: item.skin_id, native_classes: [...item.native_classes].sort(),
      attributes: Object.entries(item.attributes).sort(([a], [b]) => a.localeCompare(b)),
      variables: Object.entries(item.variables).sort(([a], [b]) => a.localeCompare(b)),
    })))
    const current_signature = signature(snapshots)
    for (const previous of backups) {
      if (!/^[0-9a-f-]{36}$/.test(previous.id)) continue
      try {
        const saved = await this.read_backup_file(previous.id)
        if (signature(saved.snapshots) === current_signature) {
          return { ...previous, theme_name: await this.snapshot_theme_name(snapshots), available: true, unavailable_reason: undefined }
        }
      } catch { /* 缺失或损坏的旧备份不能代替当前恢复点，原文件保留。 */ }
    }
    const entry: ThemeBackup = { id: randomUUID(), created_at: new Date().toISOString(), name, theme_name: await this.snapshot_theme_name(snapshots), windows: snapshots.length, available: true }
    await this.json_write(`${entry.id}.json`, { id: entry.id, created_at: entry.created_at, name: entry.name, theme_name: entry.theme_name, windows: entry.windows, schema: 1, snapshots })
    await this.json_write('index.json', [entry, ...backups])
    return entry
  }

  private payload(id: string): Promise<string> {
    return build_skin_payload(id, this.motion_enabled, join(this.resources, 'skins'), join(this.resources, 'theme-engine'))
  }

  private async restore_snapshot(connection: ThemeConnection, snapshot: Snapshot): Promise<void> {
    const removed = await connection.evaluate<boolean>(remove_expression)
    if (!removed) throw Error('旧主题未完整卸载，恢复已停止')
    await connection.evaluate(`(() => {
      const value=${JSON.stringify(snapshot)}, root=document.documentElement;
      root.classList.remove('light','dark'); root.classList.add(...value.native_classes);
      for(const [key,item] of Object.entries(value.attributes)) item===null?root.removeAttribute(key):root.setAttribute(key,item);
      for(const key of [...root.style])if(/^(--(color|theme|sidebar|background|foreground|font)-|color-scheme$|font-family$)/.test(key))root.style.removeProperty(key);
      for(const [key,item] of Object.entries(value.variables))root.style.setProperty(key,item);
      return true;
    })()`)
    if (snapshot.skin_id) await this.inject(connection, snapshot.skin_id, await this.payload(snapshot.skin_id))
  }

  private async inject(connection: ThemeConnection, id: string, payload: string): Promise<void> {
    const installed = await connection.evaluate<{ installed: boolean; themeId: string }>(payload)
    if (!installed?.installed || installed.themeId !== id) throw Error('Codex 未确认主题已应用')
    const verified = await connection.evaluate<boolean>(`window.__CODEX_DREAM_SKIN_STATE__?.themeId === ${JSON.stringify(id)} && !!window.__CODEX_ORIGINAL_THEME_STATE__ && !!document.getElementById('codex-dream-skin-style') && !!document.getElementById('codex-original-theme-style')`)
    if (!verified) throw Error('应用后的主题校验失败')
  }

  async status(): Promise<ThemeRuntimeStatus> {
    const backups = await this.read_backups()
    let connections: ThemeConnection[] = []
    try {
      connections = await this.connect()
      return { connected: true, active_id: this.active_id, backups, message: this.last_error || `已连接 ${connections.length} 个 Codex 窗口`, motion_enabled: this.motion_enabled }
    } catch (error) {
      return { connected: false, active_id: this.active_id, backups, message: this.last_error || (error instanceof Error ? error.message : 'Codex 尚未连接'), motion_enabled: this.motion_enabled }
    } finally { connections.forEach(connection => connection.close()) }
  }

  backup(): Promise<ThemeBackup | null> {
    return this.exclusive(async () => {
      const connections = await this.connect()
      try { return await this.persist_backup(await this.capture(connections), '手动备份当前 Codex 主题') }
      finally { connections.forEach(connection => connection.close()) }
    })
  }

  remove_backup(id: string): Promise<void> {
    return this.exclusive(async () => {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('主题备份不存在')
      const entries = await this.read_index()
      if (!entries.some(entry => entry.id === id)) throw Error('主题备份不存在')
      try { await unlink(join(this.directory, `${id}.json`)) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('备份文件删除失败，索引已保留')
      }
      try { await this.json_write('index.json', entries.filter(entry => entry.id !== id)) }
      catch { throw Error('备份文件已删除，但索引更新失败；请重试删除该记录') }
    })
  }

  apply(id: string): Promise<ThemeBackup | null> {
    return this.exclusive(async () => {
      const payload = await this.payload(id)
      const connections = await this.connect()
      try {
        const snapshots = await this.capture(connections)
        const backup = await this.persist_backup(snapshots, '应用主题前自动备份')
        try {
          for (const connection of connections) await this.inject(connection, id, payload)
          await this.json_write('active.json', { schema: 2, id }); this.active_id = id; this.last_error = ''
        } catch (error) {
          const restored = await Promise.allSettled(connections.map((connection, index) => this.restore_snapshot(connection, snapshots[index])))
          if (restored.some(result => result.status === 'rejected')) throw Error(`主题应用失败，自动恢复未全部成功；${backup ? `可从备份 ${backup.id} 重试恢复` : '可从主题馆重新应用原主题'}`)
          throw error
        }
        return backup
      } finally { connections.forEach(connection => connection.close()) }
    })
  }

  restore(id: string): Promise<void> {
    return this.exclusive(async () => {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('主题备份不存在')
      const entry = (await this.read_backups()).find(item => item.id === id)
      if (!entry) throw Error('主题备份不存在')
      if (!entry.available) throw Error(entry.unavailable_reason || '主题备份不可用')
      const backup = await this.read_backup_file(id)
      const connections = await this.connect()
      try {
        const current = await this.capture(connections)
        const recovery = await this.persist_backup(current, '恢复主题前自动备份')
        try {
          for (let index = 0; index < connections.length; index++) await this.restore_snapshot(connections[index], backup.snapshots[index] || backup.snapshots[0])
          const next = backup.snapshots[0].skin_id
          await this.json_write('active.json', { schema: 2, id: next }); this.active_id = next; this.last_error = ''
        } catch (error) {
          const restored = await Promise.allSettled(connections.map((connection, index) => this.restore_snapshot(connection, current[index])))
          if (restored.some(result => result.status === 'rejected')) throw Error(`恢复失败且自动回退未全部成功；${recovery ? `可从备份 ${recovery.id} 重试恢复` : '可从主题馆重新应用原主题'}`)
          throw error
        }
      } finally { connections.forEach(connection => connection.close()) }
    })
  }

  set_motion(enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      if (typeof enabled !== 'boolean') throw Error('主题动效设置无效')
      this.motion_enabled = enabled
      await this.json_write('settings.json', { motion_enabled: enabled })
      if (!this.active_id) return
      let connections: ThemeConnection[] = []
      try {
        connections = await this.connect()
        for (const connection of connections) await connection.evaluate(`!!window.__CODEX_ORIGINAL_THEME_STATE__?.setMotion(${enabled})`)
      } catch { this.last_error = '动效设置已保存，将在主题下次应用或客户端重载时生效' }
      finally { connections.forEach(connection => connection.close()) }
    })
  }

  async resume(): Promise<void> {
    try {
      const settings = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'))
      if (typeof settings.motion_enabled !== 'boolean') throw Error('invalid')
      this.motion_enabled = settings.motion_enabled
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.last_error = '主题动效设置不可用，已使用默认设置'
    }
    try {
      const saved = JSON.parse(await readFile(join(this.directory, 'active.json'), 'utf8'))
      if (saved.schema === 2 && typeof saved.id === 'string') {
        await this.payload(saved.id); this.active_id = saved.id
      } else if (typeof saved.id === 'string') this.last_error = '已忽略旧版主题自动应用记录，请重新选择主题'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.last_error = '自动应用记录不可用，请重新选择主题'
    }
  }

  maintain(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.active_id) return
      let connections: ThemeConnection[] = []
      try {
        connections = await this.connect()
        for (const connection of connections) {
          const present = await connection.evaluate<string | null>('window.__CODEX_DREAM_SKIN_STATE__?.themeId || null')
          if (present === null) {
            const snapshots = await this.capture([connection])
            await this.persist_backup(snapshots, '自动恢复皮肤前备份原生外观')
            try { await this.inject(connection, this.active_id, await this.payload(this.active_id)) }
            catch (error) { await this.restore_snapshot(connection, snapshots[0]); throw error }
          } else await connection.evaluate(`!!window.__CODEX_ORIGINAL_THEME_STATE__?.setMotion(${this.motion_enabled})`)
        }
        this.last_error = ''
      } catch { this.last_error = '自动应用等待连接；若客户端已更新，请重新连接并检查主题效果' }
      finally { connections.forEach(connection => connection.close()) }
    })
  }
}
