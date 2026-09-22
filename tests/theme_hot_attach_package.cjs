// 验证换肤连接代码、离线资源和打包后的 Node 助手；不启动或连接真实 Codex。
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const release_dir = process.argv[2]
assert.ok(release_dir && path.isAbsolute(release_dir), '请提供安装包输出目录的绝对路径')
const store = path.join(root, 'node_modules/.pnpm')
const asar_name = fs.readdirSync(store).find(name => name.startsWith('@electron+asar@'))
const asar = require(path.join(store, asar_name, 'node_modules/@electron/asar'))
const binary = path.join(release_dir, 'win-unpacked/Codex-Manager.exe')
const archive = path.join(release_dir, 'win-unpacked/resources/app.asar')
let verified_files = 0
function verify_tree(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) verify_tree(name)
    else {
      assert.deepEqual(asar.extractFile(archive, name), fs.readFileSync(path.join(root, name)), `包内文件与构建产物不一致：${name}`)
      verified_files++
    }
  }
}
verify_tree('out')
verify_tree('resources')
const helper = spawnSync(binary, ['-e', 'console.log(JSON.stringify({debug_process:typeof process._debugProcess,node:process.versions.node}))'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 10000
})
assert.equal(helper.status, 0, `打包后的 Node 助手执行失败：${helper.stderr}`)
const helper_result = JSON.parse(helper.stdout.trim())
assert.equal(helper_result.debug_process, 'function', '打包后的助手缺少调试唤醒接口')
const installer = path.join(release_dir, 'Codex-Manager-2.0.1-Windows-x64.exe')
const bytes = fs.readFileSync(installer)
const report = { passed: true, verified_files, helper: helper_result, installer, installer_bytes: bytes.length, installer_sha256: createHash('sha256').update(bytes).digest('hex'), limitations: ['未执行安装向导覆盖用户安装。', '本检查验证包内代码、离线资源及助手接口，不代替真实客户端应用验收。'] }
fs.writeFileSync(path.join(root, 'reports', process.argv[3] || '运行中换肤安装包验收-20260921.json'), JSON.stringify(report, null, 2))
console.log('运行中换肤安装包验收通过：' + JSON.stringify(report))
