// 验证自己启动的无调试端口Electron能否事后唤醒Inspector，再转发页面CDP。
// 不接收外部PID，不连接真实Codex，不修改任何用户配置。
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const report_path = path.join(__dirname, '../reports/运行中开启调试隔离验证-20260921.json')

async function target_main() {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', process.env.RESEARCH_SANDBOX)
  process.debugPort = Number(process.env.RESEARCH_DEBUG_PORT)
  await app.whenReady()
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>独立调试实验</title><textarea>未发送的中文草稿</textarea>'))
  globalThis.research_window = window
  globalThis.research_navigations = 0
  window.webContents.on('did-navigate', () => globalThis.research_navigations++)
  await window.webContents.executeJavaScript('window.research_token="页面保持"')
  process.send({ ready: true, pid: process.pid, renderer_id: window.webContents.getOSProcessId(), versions: process.versions, inspector_url: require('node:inspector').url() ?? null })
  process.on('message', message => {
    if (message === '结束实验') {
      require('node:inspector').close()
      window.destroy()
      app.exit(0)
    }
  })
}

async function controller_main() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'late-debug-attach-'))
  const child_env = { ...process.env, RESEARCH_SANDBOX: sandbox, RESEARCH_DEBUG_PORT: String(port) }
  delete child_env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--isolated-target'], {
    windowsHide: true,
    env: child_env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stderr = '', socket
  child.stderr.on('data', chunk => { stderr += chunk.toString(); process.stderr.write(chunk) })
  const report = { passed: false, scope: '仅独立Electron；并非真实Codex兼容性结论', port, sandbox, startup_debug_flags: false }
  const timeout = setTimeout(() => { child.kill(); console.error('隔离实验超时，仅终止本实验子进程'); process.exitCode = 1 }, 20000)
  try {
    const [ready] = await Promise.race([once(child, 'message'), once(child, 'exit').then(([code]) => { throw Error('实验进程在就绪前退出：'+code) })])
    report.before = ready
    assert.equal(ready.pid, child.pid)
    assert.equal(ready.inspector_url, null)
    // 只唤醒由本脚本持有的直接子进程。
    process._debugProcess(child.pid)
    let targets
    for (let attempt = 0; attempt < 40; attempt++) {
      try { targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(300) }).then(value => value.json()); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    assert.equal(targets?.length, 1, '应只出现本实验的主进程Inspector')
    socket = new WebSocket(targets[0].webSocketDebuggerUrl)
    await once(socket, 'open')
    let sequence = 0
    const pending = new Map()
    socket.addEventListener('message', event => {
      const result = JSON.parse(event.data)
      const callback = pending.get(result.id)
      if (callback) { pending.delete(result.id); result.error ? callback.reject(Error(JSON.stringify(result.error))) : callback.resolve(result.result) }
    })
    const request = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
    })
    const response = await request('Runtime.evaluate', {
      expression: `(async()=>{const w=globalThis.research_window;const d=w.webContents.debugger;d.attach('1.3');try{const page=await d.sendCommand('Runtime.evaluate',{expression:'({token:window.research_token,draft:document.querySelector("textarea").value})',returnByValue:true});return {pid:process.pid,renderer_id:w.webContents.getOSProcessId(),navigations:globalThis.research_navigations,page:page.result.value,attached:d.isAttached()}}finally{d.detach()}})()`,
      awaitPromise: true, returnByValue: true,
    })
    assert.equal(response.exceptionDetails, undefined, '主进程到页面CDP转发应成功')
    report.after = response.result.value
    assert.equal(report.after.pid, ready.pid)
    assert.equal(report.after.renderer_id, ready.renderer_id)
    assert.equal(report.after.navigations, 0)
    assert.equal(report.after.page.token, '页面保持')
    assert.equal(report.after.page.draft, '未发送的中文草稿')
    assert.equal(report.after.attached, true)
    report.passed = true
    console.log('事后开启Inspector并转发页面CDP通过，主进程、渲染进程及页面保持')
  } catch (error) {
    report.error = String(error.stack)
    console.error('隔离实验失败：', error.message)
    process.exitCode = 1
  } finally {
    report.stderr = stderr
    fs.writeFileSync(report_path, JSON.stringify(report, null, 2))
    if (socket) socket.close()
    if (child.connected) child.send('结束实验')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
    clearTimeout(timeout)
  }
}

if (process.argv.includes('--isolated-target')) target_main().catch(error => { console.error('实验进程启动失败：', error.message); process.exit(1) })
else controller_main().catch(error => { console.error('实验控制器失败：', error.message); process.exitCode = 1 })
