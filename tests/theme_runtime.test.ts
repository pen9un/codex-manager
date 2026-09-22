import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { ThemeRuntime, validate_theme_snapshot } from '../src/main/theme_runtime'
import { validate_theme_target, type ThemeConnection } from '../src/main/theme_connection'
import { create_original_catalog } from './theme_fixture'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

async function fixture(count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'manager-theme-runtime-'))
  directories.push(root)
  const resources = join(root, 'resources')
  const directory = join(root, 'theme')
  await create_original_catalog(join(resources, 'skins'))
  await cp(resolve('resources/theme-engine'), join(resources, 'theme-engine'), { recursive: true })
  const windows = Array.from({ length: count }, (_, index) => ({
    id: String(index), skin_id: null as string | null, mode: 'dark', fail: false, fail_cleanup: false, closed: 0, injections: 0, motion_enabled: true,
  }))
  const connect = async (): Promise<ThemeConnection[]> => windows.map(window => ({
    id: window.id, close() { window.closed++ }, async evaluate<T>(expression: string): Promise<T> {
      let value: unknown
      if (expression.includes('const installed =')) {
        window.injections++
        if (window.fail) { window.fail = false; throw Error('合成注入失败') }
        window.skin_id = expression.includes('"id":"moon-garden"') ? 'moon-garden' : null
        window.motion_enabled = expression.includes('let motionEnabled = true')
        value = { installed: true, themeId: window.skin_id }
      } else if (expression.includes('native_classes:')) {
        value = { skin_id: window.skin_id, native_classes: [window.mode], attributes: { 'data-theme': window.mode }, variables: { '--color-accent': '#123456' } }
      } else if (expression.includes('state?.cleanup')) { if (window.fail_cleanup) throw Error('合成卸载失败'); window.skin_id = null; value = true }
      else if (expression.includes('?.themeId || null')) value = window.skin_id
      else if (expression.includes('__CODEX_ORIGINAL_THEME_STATE__?.setMotion')) {
        window.motion_enabled = expression.includes('setMotion(true)'); value = true
      } else value = true
      return value as T
    },
  }))
  return { directory, resources, windows, connect, runtime: new ThemeRuntime(directory, connect, resources) }
}

async function legacy_theme_backup(directory: string) {
  await mkdir(directory, { recursive: true })
  const entry = { id: randomUUID(), created_at: new Date().toISOString(), name: '历史内置主题备份', windows: 1, available: true }
  const snapshots = [{ skin_id: 'moon-garden', native_classes: ['dark'], attributes: { 'data-theme': 'dark' }, variables: { '--color-accent': '#123456' } }]
  const entries = await readFile(join(directory, 'index.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  await writeFile(join(directory, `${entry.id}.json`), JSON.stringify({ ...entry, schema: 1, snapshots }))
  await writeFile(join(directory, 'index.json'), JSON.stringify([entry, ...entries]))
  return entry
}

describe('Codex 原创主题事务', () => {
  it('仅有内置主题时手动与自动备份均跳过，旧备份仍然保留', async () => {
    const { runtime, windows, directory } = await fixture(2)
    windows.forEach(window => { window.skin_id = 'moon-garden' })
    expect(await runtime.backup()).toBeNull()
    await expect(readFile(join(directory, 'index.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const legacy = await legacy_theme_backup(directory)
    expect(await runtime.apply('moon-garden')).toBeNull()
    expect((await runtime.status()).backups.map(entry => entry.id)).toEqual([legacy.id])
  })

  it('内置主题应用回退失败时引导重新应用主题，不生成虚假备份标识', async () => {
    const { runtime, windows } = await fixture()
    await runtime.apply('moon-garden')
    windows[0].fail = true
    windows[0].fail_cleanup = true
    await expect(runtime.apply('moon-garden')).rejects.toThrow('可从主题馆重新应用原主题')
    expect((await runtime.status()).backups).toHaveLength(1)
  })

  it('从内置主题恢复失败且回退失败时不引用不存在的备份', async () => {
    const { runtime, windows } = await fixture()
    const original = (await runtime.apply('moon-garden'))!
    windows[0].fail_cleanup = true
    await expect(runtime.restore(original.id)).rejects.toThrow('可从主题馆重新应用原主题')
    expect((await runtime.status()).backups).toHaveLength(1)
  })

  it('混合窗口应用失败时使用完整内存快照回退并保留对应原生恢复点', async () => {
    const { runtime, windows, directory } = await fixture(2)
    windows[0].skin_id = 'moon-garden'
    windows[1].fail = true
    await expect(runtime.apply('moon-garden')).rejects.toThrow('合成注入失败')
    expect(windows.map(window => window.skin_id)).toEqual(['moon-garden', null])
    const backups = (await runtime.status()).backups
    expect(backups).toHaveLength(1)
    expect(JSON.parse(await readFile(join(directory, `${backups[0].id}.json`), 'utf8')).snapshots.map((item: { skin_id: string | null }) => item.skin_id)).toEqual(['moon-garden', null])
  })

  it('删除备份无需连接 Codex，保留当前应用主题、设置和其它备份', async () => {
    const { runtime, windows, directory, resources } = await fixture()
    const original = (await runtime.apply('moon-garden'))!
    const legacy = await legacy_theme_backup(directory)
    await runtime.set_motion(false)
    const active = await readFile(join(directory, 'active.json'), 'utf8')
    const settings = await readFile(join(directory, 'settings.json'), 'utf8')
    const disconnected = new ThemeRuntime(directory, async () => { throw Error('测试 Codex 未连接') }, resources)
    await disconnected.resume()
    await disconnected.remove_backup(original.id)
    const status = await disconnected.status()
    expect(status).toMatchObject({ connected: false, active_id: 'moon-garden' })
    expect(status.backups.map(entry => entry.id)).toEqual([legacy.id])
    await expect(readFile(join(directory, `${original.id}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(directory, 'active.json'), 'utf8')).toBe(active)
    expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe(settings)
    expect(windows[0].skin_id).toBe('moon-garden')
  })

  it('删除缺失、损坏和内置历史备份后清理索引', async () => {
    const { runtime, directory } = await fixture()
    const original = (await runtime.backup())!
    await rm(join(directory, `${original.id}.json`))
    await runtime.remove_backup(original.id)
    const damaged = await legacy_theme_backup(directory)
    await writeFile(join(directory, `${damaged.id}.json`), '{损坏')
    await runtime.remove_backup(damaged.id)
    const legacy = await legacy_theme_backup(directory)
    await runtime.remove_backup(legacy.id)
    expect((await runtime.status()).backups).toEqual([])
    await expect(readFile(join(directory, `${damaged.id}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('删除只接受索引中的 UUID，不触及未登记文件或活动主题记录', async () => {
    const { runtime, directory } = await fixture()
    await runtime.apply('moon-garden')
    const unknown = randomUUID()
    const outside = join(directory, `${unknown}.json`)
    await writeFile(outside, '未登记文件')
    for (const id of ['../active', 'active', '-'.repeat(36), unknown]) await expect(runtime.remove_backup(id)).rejects.toThrow('主题备份不存在')
    expect(await readFile(outside, 'utf8')).toBe('未登记文件')
    expect(JSON.parse(await readFile(join(directory, 'active.json'), 'utf8')).id).toBe('moon-garden')
    expect((await runtime.status()).backups).toHaveLength(1)
  })

  it('备份文件删除失败时保留索引，不递归删除目录', async () => {
    const { runtime, directory } = await fixture()
    const backup = (await runtime.backup())!
    const file = join(directory, `${backup.id}.json`)
    await rm(file)
    await mkdir(file)
    await writeFile(join(file, 'keep.txt'), '保留内容')
    await expect(runtime.remove_backup(backup.id)).rejects.toThrow('备份文件删除失败，索引已保留')
    expect(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))[0].id).toBe(backup.id)
    expect(await readFile(join(file, 'keep.txt'), 'utf8')).toBe('保留内容')
  })

  it('删除文件后索引写入失败会明确提示，重试可清理缺失记录', async () => {
    const { runtime, directory } = await fixture()
    const backup = (await runtime.backup())!
    const write = vi.spyOn(runtime as unknown as { json_write(name: string, value: unknown): Promise<void> }, 'json_write').mockRejectedValueOnce(Error('合成索引写入失败'))
    try { await expect(runtime.remove_backup(backup.id)).rejects.toThrow('备份文件已删除，但索引更新失败；请重试删除该记录') }
    finally { write.mockRestore() }
    expect((await runtime.status()).backups[0]).toMatchObject({ id: backup.id, available: false })
    await runtime.remove_backup(backup.id)
    expect((await runtime.status()).backups).toEqual([])
    await expect(readFile(join(directory, `${backup.id}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('备份与删除串行执行，删除后相同原生外观可以重新保存', async () => {
    const { runtime } = await fixture()
    const original = (await runtime.backup())!
    const [reused, , replacement] = await Promise.all([runtime.backup(), runtime.remove_backup(original.id), runtime.backup()])
    expect(reused?.id).toBe(original.id)
    expect(replacement?.id).not.toBe(original.id)
    expect((await runtime.status()).backups.map(entry => entry.id)).toEqual([replacement?.id])
  })

  it('复用较早备份后恢复和回退均失败时，提示准确的操作前恢复点', async () => {
    const { runtime, windows, directory } = await fixture()
    const original = (await runtime.backup())!
    await runtime.apply('moon-garden')
    const themed = await legacy_theme_backup(directory)
    await runtime.restore(original.id)
    expect((await runtime.status()).backups[0].id).toBe(themed.id)
    windows[0].fail_cleanup = true
    await expect(runtime.restore(themed.id)).rejects.toThrow(`可从备份 ${original.id} 重试恢复`)
    expect((await runtime.status()).backups).toHaveLength(2)
  })

  it('已有相同外观快照时复用备份，重复应用与恢复不堆积记录', async () => {
    const { runtime, directory } = await fixture()
    const native = (await runtime.backup())!
    expect((await runtime.apply('moon-garden'))?.id).toBe(native.id)
    expect(await runtime.backup()).toBeNull()
    expect(await runtime.apply('moon-garden')).toBeNull()
    expect(await runtime.backup()).toBeNull()
    await runtime.restore(native.id)
    expect((await runtime.backup())?.id).toBe(native.id)
    expect(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))).toHaveLength(1)
  })

  it('原生模式或窗口组成变化时仍保留新的恢复点，损坏备份不能复用', async () => {
    const { runtime, windows, directory } = await fixture(2)
    const native = (await runtime.backup())!
    windows[0].mode = 'light'
    const light = (await runtime.backup())!
    expect(light.id).not.toBe(native.id)
    expect((await runtime.backup())?.id).toBe(light.id)
    windows[0].skin_id = 'moon-garden'
    const mixed = (await runtime.backup())!
    expect(mixed.id).not.toBe(light.id)
    const file = join(directory, `${mixed.id}.json`)
    expect(JSON.parse(await readFile(file, 'utf8')).snapshots.map((item: { skin_id: string | null }) => item.skin_id)).toEqual(['moon-garden', null])
    await writeFile(file, '{损坏')
    const replacement = (await runtime.backup())!
    expect(replacement.id).not.toBe(mixed.id)
    expect(await readFile(file, 'utf8')).toBe('{损坏')
  })

  it('备份标明实际保存的主题，多窗口不误标为单一主题', async () => {
    const { runtime, windows, directory } = await fixture(2)
    expect(await runtime.backup()).toMatchObject({ theme_name: 'Codex 原生外观' })
    await runtime.apply('moon-garden')
    expect(await runtime.backup()).toBeNull()
    windows[1].skin_id = null
    const mixed = (await runtime.backup())!
    expect(mixed).toMatchObject({ theme_name: '月下花园 / Codex 原生外观' })
    expect(JSON.parse(await readFile(join(directory, `${mixed.id}.json`), 'utf8')).theme_name).toBe('月下花园 / Codex 原生外观')
  })

  it('旧备份从快照补出主题名且不改写原文件，退出主题仍能辨认', async () => {
    const { runtime, directory } = await fixture()
    await runtime.apply('moon-garden')
    const backup = await legacy_theme_backup(directory)
    const file = join(directory, `${backup.id}.json`)
    const data = JSON.parse(await readFile(file, 'utf8'))
    delete data.theme_name
    const legacy = JSON.stringify(data)
    await writeFile(file, legacy)
    const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
    index.forEach((entry: Record<string, unknown>) => { delete entry.theme_name })
    await writeFile(join(directory, 'index.json'), JSON.stringify(index))
    expect((await runtime.status()).backups.find(entry => entry.id === backup.id)?.theme_name).toBe('月下花园')
    expect(await readFile(file, 'utf8')).toBe(legacy)
    data.snapshots[0].skin_id = 'removed-theme'
    await writeFile(file, JSON.stringify(data))
    expect((await runtime.status()).backups.find(entry => entry.id === backup.id)).toMatchObject({ available: false, theme_name: '无法读取主题（removed-theme）' })
  })

  it('恢复只接受外观属性，拒绝被篡改的快照', () => {
    const snapshot = { skin_id: null, native_classes: ['dark'], attributes: { 'data-theme': 'dark' }, variables: { '--color-accent': '#123456' } }
    expect(validate_theme_snapshot(snapshot)).toEqual(snapshot)
    expect(() => validate_theme_snapshot({ ...snapshot, attributes: { onclick: 'alert(1)' } })).toThrow()
    expect(() => validate_theme_snapshot({ ...snapshot, variables: { '--color-accent': 'url(https://example.com)' } })).toThrow()
    expect(() => validate_theme_snapshot({ ...snapshot, native_classes: ['hidden'] })).toThrow()
  })

  it('应用前备份，使用持久动效设置，并可恢复原生主题', async () => {
    const { runtime, windows, directory } = await fixture()
    await runtime.set_motion(false)
    const original = (await runtime.backup())!
    await runtime.apply('moon-garden')
    expect(windows[0]).toMatchObject({ skin_id: 'moon-garden', motion_enabled: false })
    expect((await runtime.status()).motion_enabled).toBe(false)
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).toEqual({ motion_enabled: false })
    await runtime.restore(original.id)
    expect(windows[0].skin_id).toBeNull()
    expect((await runtime.status()).active_id).toBeNull()
  })

  it('动效开关即时更新已挂载窗口，预览参数不参与运行设置', async () => {
    const { runtime, windows } = await fixture()
    await runtime.apply('moon-garden')
    await runtime.set_motion(false)
    expect(windows[0].motion_enabled).toBe(false)
    await runtime.set_motion(true)
    expect(windows[0].motion_enabled).toBe(true)
  })

  it('仅恢复新格式 active 记录，忽略旧格式记录', async () => {
    const old = await fixture()
    await mkdir(old.directory, { recursive: true })
    await writeFile(join(old.directory, 'active.json'), JSON.stringify({ id: 'moon-garden' }))
    await old.runtime.resume()
    await old.runtime.maintain()
    expect(old.windows[0].injections).toBe(0)
    expect((await old.runtime.status()).active_id).toBeNull()

    const current = await fixture()
    await current.runtime.apply('moon-garden')
    const restarted = new ThemeRuntime(current.directory, current.connect, current.resources)
    current.windows[0].skin_id = null
    await restarted.resume()
    await restarted.maintain()
    expect(current.windows[0].skin_id).toBe('moon-garden')
  })

  it('备份文件缺失时保留索引并返回中文不可用原因', async () => {
    const { runtime, directory } = await fixture()
    const backup = (await runtime.backup())!
    await rm(join(directory, `${backup.id}.json`))
    const status = await runtime.status()
    expect(status.backups[0]).toMatchObject({ id: backup.id, available: false })
    expect(status.backups[0].unavailable_reason).toContain('备份文件缺失')
    expect(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))).toHaveLength(1)
    await expect(runtime.restore(backup.id)).rejects.toThrow('备份文件缺失')
  })

  it('索引数组包含无效成员时返回中文损坏原因', async () => {
    const { runtime, directory } = await fixture()
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'index.json'), '[null]')
    await expect(runtime.status()).rejects.toThrow('主题备份索引无法读取，未覆盖原文件')
  })

  it('备份损坏或引用主题缺失时返回原因且不删除原文件', async () => {
    const damaged = await fixture()
    const damaged_backup = (await damaged.runtime.backup())!
    await writeFile(join(damaged.directory, `${damaged_backup.id}.json`), '{损坏')
    expect((await damaged.runtime.status()).backups[0]).toMatchObject({ available: false, unavailable_reason: '主题备份内容损坏' })
    expect(await readFile(join(damaged.directory, `${damaged_backup.id}.json`), 'utf8')).toBe('{损坏')

    const missing_skin = await fixture()
    await missing_skin.runtime.apply('moon-garden')
    const skin_backup = await legacy_theme_backup(missing_skin.directory)
    await rm(join(missing_skin.resources, 'skins'), { recursive: true, force: true })
    const entry = (await missing_skin.runtime.status()).backups.find(item => item.id === skin_backup.id)
    expect(entry?.available).toBe(false)
    expect(entry?.unavailable_reason).toContain('主题目录无法读取')
    expect(await readFile(join(missing_skin.directory, `${skin_backup.id}.json`), 'utf8')).toContain('moon-garden')
  })

  it('一个窗口失败时所有已改窗口回退，持久选择不变', async () => {
    const { runtime, windows } = await fixture(2)
    await runtime.apply('moon-garden')
    windows[1].fail = true
    await expect(runtime.apply('moon-garden')).rejects.toThrow('合成注入失败')
    expect(windows.map(window => window.skin_id)).toEqual(['moon-garden', 'moon-garden'])
    expect((await runtime.status()).active_id).toBe('moon-garden')
  })

  it('拒绝路径穿越，并提示旧主题通过正常重启卸载', async () => {
    const { runtime, windows } = await fixture()
    await expect(runtime.apply('../auth.json')).rejects.toThrow()
    await expect(runtime.restore('../active')).rejects.toThrow('备份不存在')
    windows[0].skin_id = 'foreign-theme'
    await expect(runtime.apply('moon-garden')).rejects.toThrow('正常退出并重新启动 Codex')
    expect(windows[0].injections).toBe(0)
  })

  it('仅允许本地指定端口的应用页面，拒绝凭据 URL 和远程目标', () => {
    const target = { id: '1', type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9341/devtools/page/1' }
    expect(validate_theme_target(target, 9341)).toBe(target.webSocketDebuggerUrl)
    for (const url of ['ws://example.com:9341/devtools/page/1', 'ws://user@127.0.0.1:9341/devtools/page/1', 'ws://127.0.0.1:9222/devtools/page/1']) expect(() => validate_theme_target({ ...target, webSocketDebuggerUrl: url }, 9341)).toThrow()
    expect(() => validate_theme_target({ ...target, url: 'https://chatgpt.com' }, 9341)).toThrow()
  })
})
