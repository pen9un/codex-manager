// 发布前验证版本、安装包集合和文件摘要，避免上传本地数据或残缺产物。
const { createReadStream } = require('node:fs')
const { appendFile, copyFile, lstat, mkdir, readdir, writeFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')

const targets = {
  'win-x64': ['Windows-x64.exe'],
  'mac-x64': ['macOS-x64.dmg', 'macOS-x64.zip'],
  'mac-arm64': ['macOS-arm64.dmg', 'macOS-arm64.zip'],
  'linux-x64': ['Linux-x64.AppImage', 'Linux-x64.deb'],
}

function release_metadata(version, ref = '') {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) {
    throw Error('版本号必须是语义化版本，例如 2.0.2 或 2.1.0-beta.1')
  }
  const tag = `v${version}`
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/${tag}`) throw Error('发布标签必须与 package.json 版本号一致')
  return { version, tag, prerelease: !!match[4] }
}

function expected_assets(version, platform, arch) {
  release_metadata(version)
  const suffixes = platform ? targets[`${platform}-${arch}`] : Object.values(targets).flat()
  if (!suffixes) throw Error('不支持的构建平台或架构')
  return suffixes.map(suffix => `Codex-Manager-${version}-${suffix}`)
}

async function check_file(file) {
  const info = await lstat(file)
  if (!info.isFile()) throw Error(`安装包必须是普通文件：${path.basename(file)}`)
  if (info.size === 0) throw Error(`安装包为空：${path.basename(file)}`)
}

async function collect_assets(source, output, version, platform, arch) {
  const names = expected_assets(version, platform, arch)
  // 先核对完整集合，再复制；只允许明确列出的安装包进入附件目录。
  for (const name of names) await check_file(path.join(source, name))
  await mkdir(output, { recursive: true })
  for (const name of names) await copyFile(path.join(source, name), path.join(output, name))
  return names
}

async function prepare_release(directory, version) {
  const names = expected_assets(version).sort()
  const entries = await readdir(directory)
  const missing = names.filter(name => !entries.includes(name))
  const extra = entries.filter(name => !names.includes(name) && name !== 'SHA256SUMS.txt')
  if (missing.length) throw Error(`发布产物缺少：${missing.join('、')}`)
  if (extra.length) throw Error(`发布目录包含额外文件：${extra.join('、')}`)
  const sums = []
  for (const name of names) {
    const file = path.join(directory, name)
    await check_file(file)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    sums.push(`${hash.digest('hex')}  ${name}`)
  }
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
  return names
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const version = require(path.join(root, 'package.json')).version
  const metadata = release_metadata(version, process.env.GITHUB_REF || '')
  const [command, platform, arch] = process.argv.slice(2)
  const directory = path.join(root, 'releases/artifacts')
  if (command === 'metadata') {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''))
    console.log(`版本校验通过：${metadata.tag}（${metadata.prerelease ? '预发布' : '正式版'}）`)
  } else if (command === 'collect') {
    const names = await collect_assets(path.join(root, 'releases'), directory, version, platform, arch)
    console.log(`已收集 ${names.length} 个 ${platform}/${arch} 安装包`)
  } else if (command === 'prepare') {
    const names = await prepare_release(directory, version)
    await writeFile(path.join(root, 'releases/RELEASE_NOTES.md'), [
      `## Codex Manager ${metadata.tag}`, '',
      '### 下载选择', '',
      '- Windows x64：下载 `.exe` 安装程序。',
      '- macOS Intel：下载 `macOS-x64.dmg`；Apple Silicon：下载 `macOS-arm64.dmg`。同时提供 ZIP。',
      '- Linux x64：下载 `.AppImage`；Debian / Ubuntu 也可使用 `.deb`。', '',
      '### 校验与兼容性', '',
      '- `SHA256SUMS.txt` 包含本次全部安装包的 SHA-256 摘要。',
      '- Windows 安装器未使用开发者证书签名；macOS 使用 ad-hoc 签名，未完成 Apple 公证。',
      '- 自动化测试与构建通过不代表所有桌面环境和 Codex 版本均已实机验收。',
      '- 本项目不包含客户端自动更新功能，请从 Releases 下载新版本。', '',
    ].join('\n'))
    console.log(`发布集合校验通过：${names.length} 个安装包，已生成 SHA256SUMS.txt 和版本说明`)
  } else throw Error('用法：node scripts/release.cjs metadata | collect <win|mac|linux> <x64|arm64> | prepare')
}

module.exports = { release_metadata, expected_assets, collect_assets, prepare_release }
if (require.main === module) main().catch(error => { console.error(`发布检查失败：${error.message}`); process.exitCode = 1 })
