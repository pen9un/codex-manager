import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_memory_service } from '../src/main/memory_service'
import { create_memory_mutations } from '../src/main/memory_mutations'

describe('记忆文件增删改与备份恢复', () => {
  let root: string
  let source: string
  let backups: string
  let service: ReturnType<typeof create_memory_service>
  let mutations: ReturnType<typeof create_memory_mutations>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memory-mutations-'))
    source = join(root, 'codex', 'memories', 'MEMORY.md')
    backups = join(root, 'manager', 'memory-backups')
    await mkdir(join(root, 'codex', 'memories'), { recursive: true })
    await writeFile(source, '\uFEFF# 原始记忆\r\n\r\n中文内容\r\n')
    service = create_memory_service({ codex_home: join(root, 'codex') })
    mutations = create_memory_mutations(service, backups)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const current = async () => {
    const catalog = await service.refresh()
    return service.read(catalog.files.find(file => file.relative_path === 'MEMORY.md')!.id)
  }

  it('编辑前备份原始字节并保留 BOM 与 CRLF，恢复后完全一致', async () => {
    const original = await readFile(source)
    const doc = await current()
    const result = await mutations.save({ id: doc.file.id, expected_version: doc.version, content: '# 已更正\n\n中文修改\n' })
    expect(await readFile(source, 'utf8')).toBe('\uFEFF# 已更正\r\n\r\n中文修改\r\n')
    const history = await mutations.list_backups()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ kind: 'save', status: 'completed', restorable: true })
    expect((await mutations.read_backup(result.backup_id!)).content).toContain('中文内容')
    await mutations.restore(result.backup_id!)
    expect(await readFile(source)).toEqual(original)
    expect((await mutations.list_backups())[0].status).toBe('restored')
  })

  it('LF 文件和空文件可编辑，无 BOM 不会自动添加', async () => {
    await writeFile(source, '')
    const doc = await current()
    await mutations.save({ id: doc.file.id, expected_version: doc.version, content: '新的内容\n' })
    expect(await readFile(source, 'utf8')).toBe('新的内容\n')
  })

  it('编码 BOM 后的正文 U+FEFF 字符不会被保存流程误删', async () => {
    await writeFile(source, '\uFEFF\uFEFF正文字符\n')
    const original = await readFile(source)
    const doc = await current()
    await mutations.save({ id: doc.file.id, expected_version: doc.version, content: doc.content })
    expect(await readFile(source)).toEqual(original)
    expect(await mutations.list_backups()).toHaveLength(0)
  })

  it('中断产生的无清单备份可以明确清理，但不得删除未知文件', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const folder = join(backups, id)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'original.bin'), '中断时保留的内容')
    expect((await mutations.list_backups())[0]).toMatchObject({ id, status: 'uncertain', restorable: false })
    await expect(mutations.restore(id)).rejects.toThrow()
    await writeFile(join(folder, 'unrelated.txt'), '未知文件不允许清理')
    await expect(mutations.remove_backup(id)).rejects.toThrow(/未知文件/)
    expect(await readFile(join(folder, 'unrelated.txt'), 'utf8')).toBe('未知文件不允许清理')
    await rm(join(folder, 'unrelated.txt'))
    await mutations.remove_backup(id)
    expect(await mutations.list_backups()).toHaveLength(0)
    expect(await readFile(source, 'utf8')).toContain('中文内容')
  })

  it('外部改动后拒绝保存和删除，不生成多余备份', async () => {
    const doc = await current()
    await writeFile(source, '外部更新')
    await expect(mutations.save({ id: doc.file.id, expected_version: doc.version, content: '过时草稿' })).rejects.toThrow(/变化|修改|冲突/)
    await expect(mutations.remove({ id: doc.file.id, expected_version: doc.version })).rejects.toThrow(/变化|修改|冲突/)
    expect(await readFile(source, 'utf8')).toBe('外部更新')
    expect(await mutations.list_backups()).toHaveLength(0)
  })

  it('重复提交串行执行，只有首个修改成功', async () => {
    const doc = await current()
    const input = { id: doc.file.id, expected_version: doc.version, content: '修改一次' }
    const results = await Promise.allSettled([mutations.save(input), mutations.save(input)])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(await mutations.list_backups()).toHaveLength(1)
  })

  it('删除只影响选中文件，恢复要求目标不存在', async () => {
    await writeFile(join(root, 'codex', 'memories', 'memory_summary.md'), '其他摘要')
    const doc = await current()
    const result = await mutations.remove({ id: doc.file.id, expected_version: doc.version })
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, 'codex', 'memories', 'memory_summary.md'), 'utf8')).toBe('其他摘要')
    await writeFile(source, 'Codex 重新生成')
    await expect(mutations.restore(result.backup_id!)).rejects.toThrow(/变化|存在|冲突/)
    expect((await mutations.list_backups())[0].restorable).toBe(false)
    await rm(source)
    await mutations.restore(result.backup_id!)
    expect(await readFile(source, 'utf8')).toContain('中文内容')
  })

  it('编辑恢复拒绝覆盖后续更新', async () => {
    const doc = await current()
    const result = await mutations.save({ id: doc.file.id, expected_version: doc.version, content: '手工更改' })
    await writeFile(source, '后续更新')
    await expect(mutations.restore(result.backup_id!)).rejects.toThrow(/变化|修改|冲突/)
    expect(await readFile(source, 'utf8')).toBe('后续更新')
  })

  it('新增写入人工目录，同名标题不覆盖，且不会改动生成记忆', async () => {
    const original = await readFile(source)
    const first = await mutations.create({ title: '长期偏好', content: '使用中文说明' })
    const second = await mutations.create({ title: '长期偏好', content: '保持最小改动' })
    expect(first.id).not.toBe(second.id)
    const files = (await service.refresh()).files.filter(file => file.category === 'notes')
    expect(files).toHaveLength(2)
    expect(files.every(file => /^extensions\/ad_hoc\/notes\/\d+-[a-f0-9-]+\.md$/.test(file.relative_path))).toBe(true)
    expect((await service.read(first.id)).content).toBe('# 长期偏好\n\n使用中文说明\n')
    expect(await readFile(source)).toEqual(original)
  })

  it('非法参数、大文件编辑和伪造标识均不写入', async () => {
    const doc = await current()
    for (const input of [null, {}, { title: '', content: '内容' }, { title: '标题', content: '' }]) {
      await expect(mutations.create(input as never)).rejects.toThrow()
    }
    await expect(mutations.save({ id: doc.file.id, expected_version: doc.version, content: 'a'.repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow(/大小|上限|过大/)
    await expect(mutations.remove({ id: '../MEMORY.md', expected_version: doc.version })).rejects.toThrow()
    await expect(mutations.restore('../outside')).rejects.toThrow()
    await expect(mutations.remove_backup('../outside')).rejects.toThrow()
    await expect(mutations.save(null as never)).rejects.toThrow()
    await expect(mutations.remove(null as never)).rejects.toThrow()
    expect(await mutations.list_backups()).toHaveLength(0)
  })

  it('备份目录不可写时源文件保持原样', async () => {
    await mkdir(join(root, 'manager'), { recursive: true })
    await writeFile(backups, '占位文件')
    const doc = await current()
    await expect(mutations.save({ id: doc.file.id, expected_version: doc.version, content: '不应保存' })).rejects.toThrow()
    expect(await readFile(source, 'utf8')).toContain('中文内容')
  })

  it('拒绝通过人工补充目录 junction 写到目录外', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await mkdir(join(root, 'codex', 'memories', 'extensions'), { recursive: true })
    await symlink(outside, join(root, 'codex', 'memories', 'extensions', 'ad_hoc'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(mutations.create({ title: '标题', content: '不得越界' })).rejects.toThrow()
    expect(await readdir(outside)).toHaveLength(0)
  })

  it('备份篡改后拒绝恢复，仍支持明确删除备份', async () => {
    const doc = await current()
    const result = await mutations.remove({ id: doc.file.id, expected_version: doc.version })
    await writeFile(join(backups, result.backup_id!, 'original.bin'), '被篡改')
    await expect(mutations.restore(result.backup_id!)).rejects.toThrow(/校验|损坏/)
    await mutations.remove_backup(result.backup_id!)
    expect(await mutations.list_backups()).toHaveLength(0)
  })

  it('重启核验已替换但未写完成标记的操作，不再次改动源文件', async () => {
    const doc = await current()
    const result = await mutations.save({ id: doc.file.id, expected_version: doc.version, content: '已经替换' })
    const path = join(backups, result.backup_id!, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.status = 'prepared'
    await writeFile(path, JSON.stringify(manifest))
    const resumed = create_memory_mutations(service, backups)
    expect((await resumed.list_backups())[0]).toMatchObject({ status: 'completed', restorable: true })
    expect(await readFile(source, 'utf8')).toContain('已经替换')
    await writeFile(source, '未知并发内容')
    manifest.status = 'prepared'
    await writeFile(path, JSON.stringify(manifest))
    expect((await resumed.list_backups())[0]).toMatchObject({ status: 'uncertain', restorable: false })
    expect(await readFile(source, 'utf8')).toBe('未知并发内容')
  })
})
