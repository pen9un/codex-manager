// 真实客户端验收：显式参数决定是否应用；不启动、不退出、不刷新客户端。
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const store = path.join(root, 'node_modules/.pnpm')
const esbuild_name = fs.readdirSync(store).find(name => name.startsWith('esbuild@'))
const { buildSync } = require(path.join(store, esbuild_name, 'node_modules/esbuild'))
const compiled = new Module(__filename, module)
compiled.filename = __filename; compiled.paths = module.paths
compiled._compile(buildSync({ entryPoints: [path.join(__dirname, 'theme_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename)
const { ThemeRuntime, connect_codex_theme, launch_codex_theme, close_owned_inspectors, discover_theme_processes, open_runtime_connection } = compiled.exports
const report_dir = path.join(root, 'reports/theme-live-attach-20260921')
fs.mkdirSync(report_dir, { recursive: true })

async function main() {
  const processes = await discover_theme_processes()
  assert.equal(processes.length, 1, '真实验收只允许一个已验证的Codex主进程')
  const candidate = processes[0]
  let connections = await connect_codex_theme()
  const report = { platform: process.platform, identity: candidate.identity, pid: candidate.pid, windows: connections.map(item => item.id), passed: false, applied: false }
  let main_connection
  try {
    for (const port of candidate.ports) {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => [])
      const target = targets.find(item => item.type === 'node' && new URL(item.webSocketDebuggerUrl).hostname === '127.0.0.1' && Number(new URL(item.webSocketDebuggerUrl).port) === port)
      if (target) { main_connection = await open_runtime_connection('live-inspector', target.webSocketDebuggerUrl); break }
    }
    assert.ok(main_connection, '需要已验证进程的Inspector')
    assert.equal(await main_connection.evaluate('process.pid'), candidate.pid)
    report.runtime = await main_connection.evaluate('({versions:process.versions,uptime:process.uptime()})')
    const window_ids = connections.map(connection => Number(connection.id.split(':').at(-1)))
    const native_state = () => main_connection.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return ${JSON.stringify(window_ids)}.map(id=>{const w=e.BrowserWindow.fromId(id);return {id,renderer_pid:w.webContents.getOSProcessId(),url:w.webContents.getURL()}})})()`)
    const capture = async name => {
      const image = await main_connection.evaluate(`(async()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');const image=await e.BrowserWindow.fromId(${window_ids[0]}).webContents.capturePage();return image.toPNG().toString('base64')})()`)
      fs.writeFileSync(path.join(report_dir, name), Buffer.from(image, 'base64'))
    }
    report.before = await native_state()
    for (const connection of connections) await connection.evaluate(`(()=>{window.__CODEX_THEME_LIVE_CHECK__={document,editors:[...document.querySelectorAll('.ProseMirror,[contenteditable=true],textarea')]};return true})()`)
    await capture('before.png')
    if (process.argv.includes('--cold-connect')) {
      // 本轮先前主动开放的Inspector关闭后，再验证生产连接入口；保持Codex进程运行。
      await main_connection.evaluate('setTimeout(()=>process.getBuiltinModule("inspector").close(),100);true')
      main_connection.close(); connections.forEach(connection => connection.close())
      await new Promise(resolve => setTimeout(resolve, 500))
      const before_connect = (await discover_theme_processes()).find(item => item.identity === candidate.identity)
      assert.ok(before_connect); assert.equal(before_connect.ports.length, 0, '冷接入前应没有本机调试端口')
      report.cold_connect = { before_ports: before_connect.ports }
      await launch_codex_theme()
      connections = await connect_codex_theme()
      const after_connect = (await discover_theme_processes()).find(item => item.identity === candidate.identity)
      assert.ok(after_connect)
      const targets = await fetch(`http://127.0.0.1:${after_connect.ports[0]}/json/list`).then(response => response.json())
      main_connection = await open_runtime_connection('live-inspector', targets[0].webSocketDebuggerUrl)
      assert.equal(await main_connection.evaluate('process.pid'), candidate.pid)
      report.cold_connect.after_ports = after_connect.ports
    }
    const theme_id = process.argv.slice(2).find(value => !value.startsWith('--'))
    if (theme_id) {
      const runtime = new ThemeRuntime(path.join(process.env.APPDATA, 'Codex-Manager/theme-backups'), connect_codex_theme, path.join(root, 'resources'))
      await runtime.resume()
      const restore_id = process.argv.find(value => value.startsWith('--restore='))?.slice('--restore='.length)
      if (restore_id) {
        await runtime.restore(restore_id)
        for (const connection of connections) assert.equal(await connection.evaluate('window.__CODEX_DREAM_SKIN_STATE__?.themeId??null'), null)
        report.native_restored = true
      }
      report.backup = await runtime.apply(theme_id)
      report.applied = true; report.theme_id = theme_id
      await capture('after.png')
    }
    report.after = await native_state()
    assert.deepEqual(report.after, report.before, '窗口、页面地址及渲染进程应保持')
    report.page_checks = []
    for (const connection of connections) {
      const state = await connection.evaluate(`(()=>{const check=window.__CODEX_THEME_LIVE_CHECK__;const result={same_document:check?.document===document,editors_preserved:check?.editors.every(editor=>editor.isConnected),theme_id:window.__CODEX_DREAM_SKIN_STATE__?.themeId??null};delete window.__CODEX_THEME_LIVE_CHECK__;return result})()`)
      report.page_checks.push(state)
      assert.equal(state.same_document, true); assert.equal(state.editors_preserved, true)
      if (theme_id) assert.equal(state.theme_id, theme_id)
    }
    report.passed = true
    console.log('真实Codex连接验证通过：'+JSON.stringify({ pid: candidate.pid, windows: report.windows, applied: report.applied, theme_id }))
  } catch (error) { report.error = String(error.stack); throw error }
  finally {
    fs.writeFileSync(path.join(report_dir, 'result.json'), JSON.stringify(report, null, 2))
    main_connection?.close(); connections.forEach(connection => connection.close())
    await close_owned_inspectors()
  }
}
main().catch(error => { console.error('真实客户端验收失败：', error.message); process.exitCode = 1 })
