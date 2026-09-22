// 在独立用户目录启动打包产物，校验离线目录、文件哈希及真实页面。
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const samples = process.argv.includes('--samples')
const release_directory = samples ? 'theme-ui-samples-20260921' : 'theme-v2-final'
const release_argument = process.argv.find(value => value.startsWith('--release-dir='))?.slice('--release-dir='.length)
if (release_argument) assert.ok(path.isAbsolute(release_argument), '--release-dir 必须是绝对路径')
const release_root = release_argument || path.join(root, 'releases', release_directory)
async function run() {
  const asar_directory = (await fs.readdir(path.join(root, 'node_modules/.pnpm'))).find(name => name.startsWith('@electron+asar@'))
  const asar = require(path.join(root, 'node_modules/.pnpm', asar_directory, 'node_modules/@electron/asar'))
  const binary = path.join(release_root, 'win-unpacked', 'Codex-Manager.exe')
  const archive = path.join(path.dirname(binary), 'resources/app.asar')
  const catalog = JSON.parse(asar.extractFile(archive, path.join('resources', 'skins', 'catalog.json')))
  const sample_ids = catalog.map(item => item.id)
  const files = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'))
  assert.equal(catalog.length, 20)
  assert.equal(files.some(name => name.startsWith('/assets/') || name.includes('/reports/') || name.endsWith('/hero-light.png')), false, '源图和报告不得进入安装包')
  const ids = [...new Set(files.filter(name => name.startsWith('/resources/skins/')).map(name => name.split('/')[3]).filter(name => name !== 'catalog.json'))].sort()
  assert.deepEqual(ids, catalog.map(item => item.id).sort(), '打包目录只能包含最终20组主题')
  let verified_files = 0
  for (const name of ['out/main/index.js', 'out/preload/index.js', 'resources/theme-engine/renderer-inject.js', 'resources/theme-engine/dream-skin.css']) {
    assert.deepEqual(asar.extractFile(archive, path.normalize(name)), await fs.readFile(path.join(root, name)))
  }
  for (const item of catalog) for (const [name, hash] of Object.entries(item.hashes)) {
    const bytes = asar.extractFile(archive, path.join('resources', 'skins', item.id, name))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
    assert.deepEqual(bytes, await fs.readFile(path.join(root, 'resources/skins', item.id, name)))
    verified_files++
  }
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'original-packaged-'))
  const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) || (samples ? path.join(root, 'reports/theme-ui-samples-20260921/packaged') : path.join(root, 'reports/theme-v2-final-packaged'))
  await fs.mkdir(output, { recursive: true })
  const env = { ...process.env, APPDATA: sandbox, LOCALAPPDATA: sandbox, USERPROFILE: sandbox, HOME: sandbox, CODEX_HOME: path.join(sandbox, '.codex') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const inspect_port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const child = spawn(binary, [`--inspect-brk=${inspect_port}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-logging=stderr'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let process_output = ''
  child.stdout.on('data', data => { process_output += data })
  child.stderr.on('data', data => { process_output += data })
  let socket
  let inspector
  try {
    // 在入口第一行执行前设置 Electron 路径，不能依赖 Windows 环境变量重定向已知目录。
    let debug_targets = []
    for (let attempt = 0; attempt < 60; attempt++) {
      debug_targets = await fetch(`http://127.0.0.1:${inspect_port}/json/list`).then(response => response.json()).catch(() => [])
      if (debug_targets[0]) break
      await pause(200)
    }
    assert.ok(debug_targets[0], '测试启动器必须在应用入口前暂停')
    inspector = new WebSocket(debug_targets[0].webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { inspector.onopen = resolve; inspector.onerror = reject })
    let debug_sequence = 0
    const debug_pending = new Map()
    let on_paused
    const paused = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('等待入口暂停超时')), 10000)
      on_paused = value => { clearTimeout(timer); resolve(value) }
    })
    inspector.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Debugger.paused') on_paused(message.params.callFrames[0].callFrameId)
      if (message.id && debug_pending.has(message.id)) {
        const entry = debug_pending.get(message.id); debug_pending.delete(message.id)
        if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result)
      }
    }
    const debug_call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++debug_sequence
      const timer = setTimeout(() => reject(Error(`入口调试超时：${method}`)), 10000)
      debug_pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      inspector.send(JSON.stringify({ id, method, params }))
    })
    await debug_call('Debugger.enable')
    await debug_call('Runtime.runIfWaitingForDebugger')
    const call_frame = await paused
    const prepared = await debug_call('Debugger.evaluateOnCallFrame', { callFrameId: call_frame, expression: `(()=>{const app=require('electron').app;app.setPath('appData',${JSON.stringify(sandbox)});require('node:os').homedir=()=>${JSON.stringify(sandbox)};return app.getPath('appData')})()`, returnByValue: true })
    assert.equal(prepared.result?.value, sandbox, JSON.stringify(prepared.exceptionDetails))
    await debug_call('Debugger.resume')
    let targets
    for (let attempt = 0; attempt < 120; attempt++) {
      targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => [])
      if (targets.some(target => target.type === 'page' && target.url.includes('index.html'))) break
      await pause(250)
    }
    const target = targets.find(item => item.type === 'page' && item.url.includes('index.html'))
    assert.ok(target, '打包应用必须正常加载主页面')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let sequence = 0
    const pending = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id); pending.delete(message.id)
        if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result)
      }
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`调试调用超时：${method}`)) }, 20000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const js = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
      assert.equal(!!result.exceptionDetails, false, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await call('Network.enable')
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await js(`!!window.codexSkins && [...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='主题')`)) break
      await pause(100)
    }
    const list = await js('window.codexSkins.list()')
    assert.equal(list.success, true); assert.equal(list.data.length, catalog.length)
    await js(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='主题').click()`)
    await pause(1200)
    assert.equal(await js(`document.querySelectorAll('.original-card').length`), catalog.length)
    const renders = []
    for (const item of catalog) {
      const result = await js(`window.codexSkins.renderPreview(${JSON.stringify(item.id)},'dark','home',false).then(x=>({success:x.success,length:x.data?.length,error:x.error}))`)
      assert.equal(result.success, true, result.error); assert.ok(result.length > 10000)
      renders.push({ id: item.id, ...result })
    }
    const extended_renders = []
    for (const id of sample_ids) for (const view of ['settings','components']) {
      const result = await js(`window.codexSkins.renderPreview(${JSON.stringify(id)},'dark',${JSON.stringify(view)},false).then(x=>({success:x.success,length:x.data?.length,error:x.error,view:${JSON.stringify(view)}}))`)
      assert.equal(result.success, true, result.error); assert.ok(result.length > 10000)
      extended_renders.push({ id, ...result })
    }
    assert.equal(extended_renders.length, 40, '二十组升级主题必须各完成设置和组件状态离线渲染')
    await js(`document.querySelector('.original-card-preview').click()`)
    await pause(1400)
    assert.equal(await js(`!!document.querySelector('iframe[title*="界面预览"]')`), true)
    const screenshot = await call('Page.captureScreenshot')
    await fs.writeFile(path.join(output, 'packaged-detail.png'), Buffer.from(screenshot.data, 'base64'))
    const installer = path.join(release_root, 'Codex-Manager-2.0.1-Windows-x64.exe')
    const bytes = await fs.readFile(installer)
    const report = { passed: true, offline: true, samples, themes: catalog.length, verified_files, renders, extended_renders, source_images_packaged: false, installer, installer_bytes: bytes.length, installer_sha256: createHash('sha256').update(bytes).digest('hex'), isolated_user_directory: sandbox, isolation: '主进程入口前通过调试器设置 appData 与 homedir，再运行未修改的打包入口；渲染器通过 CDP 模拟离线。', limitations: ['未执行安装向导覆盖用户安装；验证的是相同产物内未安装程序。', '导出完整性由服务单元测试覆盖，未自动操作系统保存对话框。'] }
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ passed: true, themes: catalog.length, verified_files, installer_sha256: report.installer_sha256 }))
  } finally {
    await fs.writeFile(path.join(output, 'process.log'), process_output)
    socket?.close()
    inspector?.close()
    // 只结束本测试启动的进程，不操作用户已有客户端。
    child.kill()
  }
}
run().catch(error => { console.error('打包产物验证失败：', error); process.exitCode = 1 })
