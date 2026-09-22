// 直接加载发布归档中的代码和资源，沿用隔离保险库、配置、网络与文件对话框。
const { app } = require('electron')
// 固定测试进程缩放，使 1600px 验收窗口不受用户桌面 DPI 与工作区大小影响。
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const archive = path.join(root, 'releases/win-unpacked/resources/app.asar')
try {
  const packaged = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'))
  assert.equal(packaged.version, require('../package.json').version)
  for (const file of ['out/main/index.js', 'out/preload/index.js', 'resources/icon.png', 'resources/icon.svg']) {
    assert.deepEqual(fs.readFileSync(path.join(archive, file)), fs.readFileSync(path.join(root, file)))
  }
  for (const license of ['awesome-copilot-LICENSE.txt', 'openai-codex-LICENSE.txt']) {
    assert.deepEqual(fs.readFileSync(path.join(archive, 'resources/licenses', license)), fs.readFileSync(path.join(root, 'src/shared/vendor', license)))
  }
  require('./ui_redesign.cjs').run_suite('full', path.join(archive, 'out/main/index.js')).catch(error => { console.error('发布包隔离验证失败：', error); app.exit(2) })
} catch (error) { console.error('发布包内容校验失败：', error); app.exit(2) }
