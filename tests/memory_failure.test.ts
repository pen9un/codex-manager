import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { create_memory_service } from '../src/main/memory_service'
import { create_memory_mutations } from '../src/main/memory_mutations'

vi.mock('node:fs/promises', async import_original => {
  const actual = await import_original<typeof fs>()
  return { ...actual, readdir: vi.fn(actual.readdir), rename: vi.fn(actual.rename) }
})
const actual = await vi.importActual<typeof fs>('node:fs/promises')
let fixture: string | undefined
afterEach(async () => {
  vi.mocked(fs.readdir).mockImplementation(actual.readdir)
  vi.mocked(fs.rename).mockImplementation(actual.rename)
  if (fixture) await actual.rm(fixture, { recursive: true, force: true })
})
async function setup() {
  fixture = await fs.mkdtemp(join(tmpdir(), 'memory-failure-'))
  const source = join(fixture, 'codex', 'memories', 'MEMORY.md')
  const backups = join(fixture, 'manager', 'backups')
  await fs.mkdir(join(fixture, 'codex', 'memories'), { recursive: true })
  await fs.writeFile(source, '# 原文件\n')
  const service = create_memory_service({ codex_home: join(fixture, 'codex') })
  const mutations = create_memory_mutations(service, backups)
  const doc = await service.read((await service.list()).files[0].id)
  return { source, backups, mutations, doc }
}

describe('记忆操作故障注入', () => {
  it('备份清理期间新出现的未知文件不能绕过白名单', async () => {
    const { backups, mutations, doc } = await setup()
    const saved = await mutations.save({ id: doc.file.id, expected_version: doc.version, content: '已保存' })
    const directory = join(backups, saved.backup_id!)
    const unknown = join(directory, 'external-note.txt')
    vi.mocked(fs.readdir).mockImplementation((async (...args: Parameters<typeof actual.readdir>) => {
      const names = await actual.readdir(...args)
      // 模拟目录枚举之后外部进程新建文件；固定快照不得包含它。
      if (String(args[0]) === directory) await actual.writeFile(unknown, '外部新文件必须保留')
      return names
    }) as typeof fs.readdir)
    await expect(mutations.remove_backup(saved.backup_id!)).rejects.toThrow()
    expect(await actual.readFile(unknown, 'utf8')).toBe('外部新文件必须保留')
  })

  it('源文件替换因占用失败时保留原内容和可核验备份', async () => {
    const { source, backups, mutations, doc } = await setup()
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(to) === source) throw Object.assign(new Error('文件正在被占用'), { code: 'EBUSY' })
      return actual.rename(from, to)
    })
    await expect(mutations.save({ id: doc.file.id, expected_version: doc.version, content: '不得替换' })).rejects.toThrow(/占用/)
    expect(await fs.readFile(source, 'utf8')).toBe('# 原文件\n')
    const history = await mutations.list_backups()
    expect(history[0]).toMatchObject({ status: 'failed', restorable: false })
    expect(await fs.readFile(join(backups, history[0].id, 'original.bin'), 'utf8')).toBe('# 原文件\n')
    expect((await fs.readdir(join(fixture!, 'codex', 'memories'))).filter(name => String(name).endsWith('.tmp'))).toHaveLength(0)
  })
})
