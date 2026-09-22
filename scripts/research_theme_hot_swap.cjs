// 只读检查已安装Codex的主题与开发工具入口，仅保存短代码片段和哈希。
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const archive = process.argv[2] || 'C:/Program Files/WindowsApps/OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0/app/resources/app.asar'
const store = path.join(root, 'node_modules/.pnpm')
const asar_name = fs.readdirSync(store).find(name=>name.startsWith('@electron+asar@'))
const asar = require(path.join(store, asar_name, 'node_modules/@electron/asar'))
const files = asar.listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''))
const package_info = JSON.parse(asar.extractFile(archive, 'package.json').toString())
const report = { archive, package_version: package_info.version, build_flavor: package_info.codexBuildFlavor, build_number: package_info.codexBuildNumber, scope: '安装包静态证据；未执行包内代码或修改运行中客户端', files: [] }
const targets = [
  [/^\.vite\/build\/bootstrap-.*\.js$/, ['allowDevtools(e)', 'isInternal:', 'readFromPackageMetadata()']],
  [/^\.vite\/build\/main-.*\.js$/, ['role:`toggleDevTools`', 'w=a.en.allowDevtools(s)', 'allowDevtools:']],
  [/^webview\/assets\/general-settings-f15dc60e0a6e\.js$/, ['canImportThemeString:', 'defaultMessage:`Import`', 'setThemePatch:']],
  [/^webview\/assets\/app-initial-.*\.js$/, ['function R7c(', 'function z7c(', 'B7c=`codex-theme-v1:`', 'importThemeString:w', 'function N7c(']],
]
for (const [pattern, needles] of targets) {
  const file = files.find(name=>pattern.test(name))
  if (!file) throw Error('当前版本没有预期证据文件，需要重新定位：'+pattern)
  const bytes = asar.extractFile(archive, path.normalize(file))
  const source = bytes.toString()
  const matches = needles.map(needle=>{
    const offset = source.indexOf(needle)
    return { needle, offset, snippet: offset < 0 ? null : source.slice(Math.max(0, offset-120), offset+560) }
  })
  report.files.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), matches })
}
const output = path.join(root, 'reports/不重启切换主题静态证据-20260921.json')
fs.writeFileSync(output, JSON.stringify(report,null,2))
console.log('只读证据已保存：'+output)
