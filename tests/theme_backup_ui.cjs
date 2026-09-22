// 在隔离目录启动管理器，验证旧备份名称的真实页面展示，不操作真实 Codex。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-backup-ui-'))
  os.homedir = () => sandbox
  app.setPath('appData', sandbox)
  delete process.env.ELECTRON_RENDERER_URL
  require('node:child_process').execFile = (...args) => { args.at(-1)(null, '[]', ''); return {} }
  const directory = path.join(sandbox, 'Codex-Manager/theme-backups')
  await fs.mkdir(directory, { recursive: true })
  const entries = []
  for (const [index, skin_id] of [null, 'fruit-base', 'lulu-duo'].entries()) {
    const entry = { id: `12345678-1234-1234-1234-12345678900${index}`, created_at: new Date().toISOString(), name: '应用主题前自动备份', windows: 1 }
    entries.push(entry)
    await fs.writeFile(path.join(directory, entry.id + '.json'), JSON.stringify({ ...entry, schema: 1, snapshots: [{ skin_id, native_classes: ['light'], attributes: {}, variables: {} }] }))
  }
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(entries))
  require(path.join(root, 'out/main/index.js'))
  await app.whenReady()
  let window
  for (let index = 0; index < 100; index++) {
    window = BrowserWindow.getAllWindows()[0]
    if (window && !window.webContents.isLoading()) break
    await pause(100)
  }
  const js = code => window.webContents.executeJavaScript(code, true)
  for (let index = 0; index < 100; index++) {
    if (await js(`!![...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='主题')`)) break
    await pause(100)
  }
  await js(`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='主题').click()`)
  for (let index = 0; index < 100; index++) {
    if (await js(`!![...document.querySelectorAll('button')].find(n=>n.textContent.includes('主题备份')&&n.textContent.includes('3'))`)) break
    await pause(100)
  }
  await js(`[...document.querySelectorAll('button')].find(n=>n.textContent.includes('主题备份')).click()`)
  const names = await js(`[...document.querySelectorAll('.theme-backup-row b')].map(n=>n.textContent)`)
  assert.equal(names.length, 3)
  assert.ok(names.some(name => name.includes('Codex 原生外观')))
  assert.ok(names.some(name => name.includes('小果与大果')))
  assert.ok(names.some(name => name.includes('噜噜与噜妹')))
  const output = path.join(root, 'reports/theme-background-fix-20260921')
  await fs.mkdir(output, { recursive: true })
  window.setContentSize(920, 650)
  await pause(500)
  await fs.writeFile(path.join(output, 'backups.png'), (await window.webContents.capturePage()).toPNG())
  await fs.writeFile(path.join(output, 'backups.json'), JSON.stringify({ passed: true, names, legacy_snapshots: true, real_codex_connected: false }, null, 2))
  console.log('旧备份页面验收通过：' + names.join('、'))
}
main().then(() => app.exit(0)).catch(error => { console.error('备份页面验收失败：', error); app.exit(1) })
