import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const { release_metadata, expected_assets, collect_assets, prepare_release } = createRequire(import.meta.url)('../scripts/release.cjs')
const fixtures: string[] = []
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-release-'))
  fixtures.push(directory)
  return directory
}
afterEach(async () => { for (const directory of fixtures.splice(0)) await rm(directory, { recursive: true, force: true }) })

describe('发布版本与安装包门禁', () => {
  it('标签必须与软件版本一致，正确区分正式版和预发布版', () => {
    expect(release_metadata('2.0.1', 'refs/tags/v2.0.1')).toEqual({ version: '2.0.1', tag: 'v2.0.1', prerelease: false })
    expect(release_metadata('2.1.0-beta.1', 'refs/tags/v2.1.0-beta.1').prerelease).toBe(true)
    expect(() => release_metadata('2.0.1', 'refs/tags/v2.0.2')).toThrow(/一致/)
    expect(release_metadata('2.0.1', 'refs/heads/main').tag).toBe('v2.0.1')
  })
  it.each(['02.0.1', '2.0', '2.0.1-beta.01', '2.0.1;echo bad', '../2.0.1'])('拒绝非法版本 %s', version => {
    expect(() => release_metadata(version)).toThrow(/版本号/)
  })
  it('只收集当前版本和当前平台的安装包，不带入凭据或调试文件', async () => {
    const directory = await fixture()
    const output = join(directory, 'artifacts')
    await writeFile(join(directory, 'Codex-Manager-2.0.1-Windows-x64.exe'), '模拟安装包')
    await writeFile(join(directory, 'accounts.json'), '模拟私密文件')
    await writeFile(join(directory, 'builder-debug.yml'), '模拟日志')
    expect(await collect_assets(directory, output, '2.0.1', 'win', 'x64')).toEqual(['Codex-Manager-2.0.1-Windows-x64.exe'])
    expect(await readFile(join(output, 'Codex-Manager-2.0.1-Windows-x64.exe'), 'utf8')).toBe('模拟安装包')
  })
  it('缺少任一必需文件或文件为空时拒绝收集', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'Codex-Manager-2.0.1-macOS-arm64.dmg'), '模拟磁盘映像')
    await expect(collect_assets(directory, join(directory, 'artifacts'), '2.0.1', 'mac', 'arm64')).rejects.toThrow()
    await writeFile(join(directory, 'Codex-Manager-2.0.1-macOS-arm64.zip'), '')
    await expect(collect_assets(directory, join(directory, 'artifacts'), '2.0.1', 'mac', 'arm64')).rejects.toThrow(/为空/)
  })
  it('完整七个安装包才生成校验清单，摘要按文件字节计算', async () => {
    const directory = await fixture()
    const names = expected_assets('2.0.1')
    expect(names).toHaveLength(7)
    for (const name of names) await writeFile(join(directory, name), `合成产物：${name}`)
    await prepare_release(directory, '2.0.1')
    const lines = (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')
    expect(lines).toEqual(names.sort().map((name: string) => `${createHash('sha256').update(`合成产物：${name}`).digest('hex')}  ${name}`))
    // 重跑只能重算相同清单，不接受混入其他版本或未审核的附件。
    await prepare_release(directory, '2.0.1')
    await writeFile(join(directory, 'Codex-Manager-9.0.0-Windows-x64.exe'), '旧版本')
    await expect(prepare_release(directory, '2.0.1')).rejects.toThrow(/额外/)
  })
  it('缺平台或伪装成安装包的目录均不能发布', async () => {
    const directory = await fixture()
    await expect(prepare_release(directory, '2.0.1')).rejects.toThrow(/缺少/)
    const names = expected_assets('2.0.1')
    for (const name of names) await writeFile(join(directory, name), '模拟安装包')
    await rm(join(directory, names[0]))
    await mkdir(join(directory, names[0]))
    await expect(prepare_release(directory, '2.0.1')).rejects.toThrow(/普通文件/)
  })
})
