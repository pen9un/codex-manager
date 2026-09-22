// 独立双窗口应用验证生产Inspector连接、30次换肤和恢复，不接收用户进程PID。
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const Module = require('node:module')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const root = path.resolve(__dirname, '..')
const report_path = process.argv.find(value => value.startsWith('--output='))?.slice(9) || path.join(root, 'reports/运行中连接多窗口验收-20260921.json')

async function target_main() {
  const { app, BrowserWindow, protocol } = require('electron')
  app.setPath('userData', process.env.RESEARCH_SANDBOX)
  process.debugPort = Number(process.env.RESEARCH_DEBUG_PORT)
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }])
  await app.whenReady()
  protocol.handle('app', () => new Response('<title>Codex</title><aside class="app-shell-left-panel"><button>Codex</button></aside><main class="main-surface" role="main"><div class="composer-surface-chrome"><textarea id="draft">未发送的中文草稿</textarea></div></main>', { headers: { 'content-type': 'text/html;charset=utf-8' } }))
  const windows = []
  for (let index = 0; index < 2; index++) {
    const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
    await window.loadURL('app://theme-inspector-fixture/task')
    await window.webContents.executeJavaScript('window.saved_editor=document.querySelector("#draft");window.saved_document=document;true')
    windows.push(window)
  }
  process.send({ pid: process.pid, inspector: require('node:inspector').url() ?? null, renderers: windows.map(window => window.webContents.getOSProcessId()) })
  process.on('message', message => {
    if (message === '结束验收') { require('node:inspector').close(); windows.forEach(window => window.destroy()); app.exit(0) }
  })
}

async function controller_main() {
  const store = path.join(root, 'node_modules/.pnpm')
  const esbuild_name = fs.readdirSync(store).find(name => name.startsWith('esbuild@'))
  const { buildSync } = require(path.join(store, esbuild_name, 'node_modules/esbuild'))
  const compiled = new Module(__filename, module)
  compiled.filename = __filename; compiled.paths = module.paths
  compiled._compile(buildSync({ entryPoints: [path.join(__dirname, 'theme_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename)
  const { ThemeRuntime, connect_inspector_process, open_runtime_connection } = compiled.exports
  const server = net.createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-inspector-integration-'))
  const env = { ...process.env, RESEARCH_SANDBOX: sandbox, RESEARCH_DEBUG_PORT: String(port) }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--isolated-target'], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stderr = '', control
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const timeout = setTimeout(() => { child.kill(); console.error('隔离验收超时，仅终止自建测试进程'); process.exitCode = 1 }, 120000)
  const report = { passed: false, scope: '隔离Electron，双窗口生产桥接，非跨平台实机', switches: 0 }
  try {
    const [ready] = await Promise.race([once(child, 'message'), once(child, 'exit').then(([code]) => { throw Error('测试进程提前退出：'+code) })])
    assert.equal(ready.inspector, null); assert.equal(ready.pid, child.pid)
    process._debugProcess(child.pid)
    let targets
    for (let attempt = 0; attempt < 40; attempt++) {
      try { targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    assert.equal(targets.length, 1)
    control = await open_runtime_connection('fixture-main', targets[0].webSocketDebuggerUrl)
    const connect = () => connect_inspector_process({ pid: child.pid, identity: `${child.pid}:fixture`, executable: require('electron'), ports: [port], wake_proof: null })
    const runtime = new ThemeRuntime(path.join(sandbox, 'backups'), connect, path.join(root, 'resources'))
    const original = await runtime.backup()
    for (let iteration = 0; iteration < 30; iteration++) {
      const id = iteration % 2 ? 'zero-day' : 'fruit-base'
      await runtime.apply(id)
      const connections = await connect()
      try {
        assert.equal(connections.length, 2)
        for (const connection of connections) {
          const state = await connection.evaluate('({document_kept:window.saved_document===document,editor_kept:window.saved_editor===document.querySelector("#draft"),draft:document.querySelector("#draft").value,theme:window.__CODEX_DREAM_SKIN_STATE__?.themeId,styles:document.querySelectorAll("#codex-dream-skin-style,#codex-original-theme-style").length})')
          assert.deepEqual(state, { document_kept: true, editor_kept: true, draft: '未发送的中文草稿', theme: id, styles: 2 })
        }
      } finally { connections.forEach(connection => connection.close()) }
      report.switches++
    }
    await runtime.restore(original.id)
    report.backups = (await runtime.status()).backups.length
    assert.equal(report.backups, 1, '只保留原生外观恢复点，内置主题切换与恢复不能增加备份')
    const restored = await connect()
    try { for (const connection of restored) assert.equal(await connection.evaluate('window.__CODEX_DREAM_SKIN_STATE__?.themeId??null'), null) }
    finally { restored.forEach(connection => connection.close()) }
    const after = await control.evaluate('(()=>{const e=process.getBuiltinModule("module").createRequire(process.execPath)("electron");return e.BrowserWindow.getAllWindows().map(w=>({renderer:w.webContents.getOSProcessId(),attached:w.webContents.debugger.isAttached(),listeners:w.webContents.debugger.listenerCount("detach")}))})()')
    assert.deepEqual(after.map(item => item.renderer).sort(), ready.renderers.sort())
    assert.ok(after.every(item => !item.attached && item.listeners === 0))
    report.after = after; report.restored = true; report.passed = true
    console.log('双窗口30次Inspector换肤和原生恢复通过，页面保持，无附加或detach监听残留')
  } catch (error) { report.error = String(error.stack); console.error('Inspector集成验收失败：', error.message); process.exitCode = 1 }
  finally {
    fs.writeFileSync(report_path, JSON.stringify({ ...report, stderr }, null, 2))
    control?.close()
    if (child.connected) child.send('结束验收')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
    clearTimeout(timeout)
  }
}
if (process.argv.includes('--isolated-target')) target_main().catch(error => { console.error('测试窗口启动失败：', error.message); process.exit(1) })
else controller_main().catch(error => { console.error('测试控制器失败：', error.message); process.exitCode = 1 })
