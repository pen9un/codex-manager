import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { has_electron_wake_fuse } from '../src/main/theme_process'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture(bytes: Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'theme-fuse-')); directories.push(directory)
  const file = join(directory, 'runtime'); await writeFile(file, bytes); return file
}
const marker = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
const fuse = (enabled: boolean) => Buffer.concat([marker, Buffer.from([1, 4]), Buffer.from(enabled ? '1111' : '1110')])

describe('macOS 调试能力读取', () => {
  it('只接受明确开启的标准Electron标记', async () => {
    expect(await has_electron_wake_fuse(await fixture(fuse(true)))).toBe(true)
    expect(await has_electron_wake_fuse(await fixture(fuse(false)))).toBe(false)
    expect(await has_electron_wake_fuse(await fixture(Buffer.from('不含标准标记的运行时')))).toBe(false)
  })
  it('通用二进制任何架构禁用时都拒绝唤醒', async () => {
    expect(await has_electron_wake_fuse(await fixture(Buffer.concat([fuse(true), Buffer.alloc(32), fuse(false)])))).toBe(false)
    expect(await has_electron_wake_fuse(await fixture(Buffer.concat([fuse(true), Buffer.alloc(32), fuse(true)])))).toBe(true)
  })
  it('分块边界保留标记，损坏或截断内容不假定支持', async () => {
    expect(await has_electron_wake_fuse(await fixture(Buffer.concat([Buffer.alloc(512 * 1024 - 12), fuse(true)])))).toBe(true)
    expect(await has_electron_wake_fuse(await fixture(Buffer.concat([fuse(true), marker])))).toBe(false)
  })
})
