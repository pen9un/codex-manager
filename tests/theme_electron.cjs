// 在独立合成窗口中验证最终20组主题的真实 CDP 注入、重载和恢复，不连接用户客户端。
const { app, BrowserWindow, protocol } = require('electron')
const Module = require('node:module')
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const port = 35000 + Math.floor(Math.random() * 15000)
const test_host = `codex-test-${randomUUID()}`
// 同步设置独立用户目录，确保 Electron 就绪之前完成隔离；遵循调用者指定的 TEMP/TMP。
const sandbox = fs_sync.mkdtempSync(path.join(os.tmpdir(), 'cam-theme-final-runtime-'))
app.setPath('userData', sandbox)
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', String(port))
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const windows = []
let report, output

async function run() {
  const output_root = path.join(root, 'reports/theme-v2-final-runtime')
  await fs.mkdir(output_root, { recursive: true })
  // 每轮单独保存证据，失败不会复用旧的成功报告，也不会覆盖历史验收。
  output = await fs.mkdtemp(path.join(output_root, 'run-'))
  report = { passed: false, sandbox, output, port, test_host, scenarios: [], errors: [] }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'resources/skins/catalog.json'), 'utf8'))
  assert.equal(catalog.length, 20, '最终主题目录必须包含20组主题')
  const ids = catalog.map(entry => entry.id)
  assert.equal(new Set(ids).size, 20, '最终主题目录不能包含重复主题')
  report.ids = ids
  const input_files = ['tests/theme_electron.cjs', 'tests/theme_electron_entry.ts', 'src/main/theme_runtime.ts', 'src/main/theme_connection.ts', 'src/main/themes.ts', 'src/main/original_engine.ts', 'resources/skins/catalog.json', 'resources/theme-engine/dream-skin.css', 'resources/theme-engine/renderer-inject.js']
  for (const id of ids) for (const name of ['theme.json', 'original.css', 'hero-light.webp', 'hero-dark.webp']) input_files.push(`resources/skins/${id}/${name}`)
  const input_hashes = async () => Object.fromEntries(await Promise.all(input_files.map(async file => [file, sha256(await fs.readFile(path.join(root, file)))])))
  report.input_hashes = await input_hashes()
  const store = path.join(root, 'node_modules/.pnpm')
  const esbuild_directory = fs_sync.readdirSync(store).find(name => name.startsWith('esbuild@'))
  assert.ok(esbuild_directory, '未找到项目 pnpm 安装的 esbuild')
  const { buildSync } = require(path.join(store, esbuild_directory, 'node_modules/esbuild'))
  const bundle = buildSync({ entryPoints: [path.join(__dirname, 'theme_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
  const compiled = new Module(__filename, module)
  compiled.filename = __filename; compiled.paths = module.paths; compiled._compile(bundle, __filename)
  const { ThemeRuntime, connect_codex_theme } = compiled.exports
  await app.whenReady()
  protocol.handle('app', request => {
    assert.equal(new URL(request.url).hostname, test_host, '仅允许访问本次合成页面')
    return new Response(`<!doctype html><html class="dark" data-theme="dark" style="--color-accent:#123456"><head><title>Codex</title><style>body{margin:0;font:16px sans-serif;background:#161b24;color:white;display:flex}aside{width:220px;height:900px}main{padding:40px;flex:1}.composer-surface-chrome{margin-top:250px;padding:20px;border:1px solid #aaa}</style></head><body><aside class="app-shell-left-panel"><button>Codex</button><p>合成项目</p></aside><main class="main-surface" role="main"><h1>主题注入隔离验证</h1><p>这是测试窗口，不是真实 Codex 客户端。</p><div class="composer-surface-chrome"><div class="ProseMirror" contenteditable="true">测试输入区</div></div></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  for (let index = 0; index < 2; index++) {
    const window = new BrowserWindow({ width: 1280, height: 900, show: false, skipTaskbar: true, focusable: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } })
    windows.push(window)
    window.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push({ window: index + 1, message: event.message }) })
    await window.loadURL(`app://${test_host}/window-${index + 1}.html`)
  }
  const connect_isolated = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500), redirect: 'error' })
    assert.ok(response.ok, '隔离调试端点应正常响应')
    const targets = await response.json()
    const pages = targets.filter(target => target.type === 'page')
    assert.equal(pages.length, windows.length, '调试端点必须只包含本次测试窗口')
    assert.ok(pages.every(target => windows.some(window => window.webContents.getURL() === target.url)), '拒绝连接其他客户端的调试端点')
    const connections = await connect_codex_theme([port])
    if (connections.length !== windows.length) { connections.forEach(connection => connection.close()); throw Error('未连接全部合成测试窗口') }
    return connections
  }
  const runtime = new ThemeRuntime(path.join(sandbox, 'backups'), connect_isolated, path.join(root, 'resources'))
  const native_state = window => window.webContents.executeJavaScript(`({classes:document.documentElement.className,theme:document.documentElement.getAttribute('data-theme'),accent:document.documentElement.style.getPropertyValue('--color-accent'),body_background:getComputedStyle(document.body).backgroundColor,main_background:getComputedStyle(document.querySelector('main')).backgroundColor,font:getComputedStyle(document.body).fontFamily})`)
  const original_states = await Promise.all(windows.map(native_state))
  const verify_theme = async id => {
    const appearances = []
    for (const window of windows) {
      const appearance = await window.webContents.executeJavaScript(`({id:window.__CODEX_DREAM_SKIN_STATE__?.themeId,original:document.documentElement.getAttribute('data-original-theme'),base_styles:document.querySelectorAll('#codex-dream-skin-style').length,original_styles:document.querySelectorAll('#codex-original-theme-style').length,motion:document.querySelectorAll('#codex-original-motion').length,state:!!window.__CODEX_ORIGINAL_THEME_STATE__,background:getComputedStyle(document.querySelector('main')).backgroundColor})`)
      assert.equal(appearance.id, id); assert.equal(appearance.original, id)
      assert.equal(appearance.base_styles, 1); assert.equal(appearance.original_styles, 1)
      assert.equal(appearance.motion, 1); assert.equal(appearance.state, true)
      assert.equal(window.isVisible(), false, '测试窗口必须保持隐藏')
      appearances.push(appearance)
    }
    return appearances
  }
  const capture = async (window, name) => {
    await pause(200)
    const screenshot = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    assert.equal(screenshot.isEmpty(), false, '隐藏窗口截图不能为空')
    assert.equal(window.isVisible(), false, '截图不得显示测试窗口')
    await fs.writeFile(path.join(output, `${name}.png`), screenshot.toPNG())
  }
  const original = await runtime.backup()
  assert.equal(original.windows, 2, '备份应包含两个隔离窗口')
  assert.equal((await runtime.status()).connected, true)
  for (const id of ids) {
    await runtime.apply(id)
    report.scenarios.push({ name: `双窗口应用：${id}`, passed: true, appearances: await verify_theme(id) })
    await capture(windows[0], id)
    console.log(`已验证双窗口应用：${id}`)
  }
  for (const window of windows) await window.loadURL(window.webContents.getURL())
  for (const window of windows) assert.equal(await window.webContents.executeJavaScript('!!window.__CODEX_DREAM_SKIN_STATE__'), false, '重载后应先清除当前文档的注入')
  await runtime.maintain()
  report.scenarios.push({ name: '双窗口页面重载后自动应用', passed: true, appearances: await verify_theme(ids.at(-1)) })
  await runtime.restore(original.id)
  for (const [index, window] of windows.entries()) {
    assert.equal(await window.webContents.executeJavaScript(`!!window.__CODEX_DREAM_SKIN_STATE__ || !!window.__CODEX_ORIGINAL_THEME_STATE__ || !!document.querySelector('#codex-dream-skin-style,#codex-original-theme-style,#codex-original-motion,[data-dream-theme],[data-original-theme],[data-original-mode]')`), false, '恢复后必须清除全部主题状态、样式及动效层')
    assert.deepEqual(await native_state(window), original_states[index], '恢复后的原生属性及外观应与备份前一致')
    await capture(window, `native-restored-${index + 1}`)
  }
  assert.equal((await runtime.status()).active_id, null, '恢复原生外观后应清除活动主题')
  await runtime.maintain()
  for (const window of windows) assert.equal(await window.webContents.executeJavaScript('!!window.__CODEX_DREAM_SKIN_STATE__'), false, '恢复后维护任务不能重新注入主题')
  report.scenarios.push({ name: '双窗口完整卸载并恢复原生外观，维护任务不再注入', passed: true, states: await Promise.all(windows.map(native_state)) })
  assert.deepEqual(report.errors, [], '合成窗口不能出现控制台错误')
  assert.deepEqual(await input_hashes(), report.input_hashes, '验收期间主题资源或运行时源码发生变化，请重新执行')
  report.passed = true
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: true, themes: ids.length, windows: windows.length, scenarios: report.scenarios.length, output }))
  windows.forEach(window => window.destroy())
  app.exit(0)
}
run().catch(async error => {
  console.error('主题集成验证失败：', error)
  if (report && output) { report.passed = false; report.error = error.stack || String(error); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)) }
  windows.forEach(window => { if (!window.isDestroyed()) window.destroy() })
  app.exit(1)
})
