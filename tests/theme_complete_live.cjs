// 对已验证的运行中 Codex 逐组换肤；不导航、不改明暗、不读取任务正文，最终恢复原主题。
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9)
assert.ok(output && path.isAbsolute(output), '请指定独立验收输出目录')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const store = path.join(root, 'node_modules/.pnpm')
const { buildSync } = require(path.join(store, fs.readdirSync(store).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'))
const compiled = new Module(__filename, module)
compiled.filename = __filename; compiled.paths = module.paths
compiled._compile(buildSync({ entryPoints: [path.join(__dirname, 'theme_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename)
const { ThemeRuntime, connect_inspector_theme, discover_theme_processes, open_runtime_connection, close_owned_inspectors } = compiled.exports

async function run() {
  fs.mkdirSync(output, { recursive: true })
  const report = { passed: false, scope: '真实客户端当前模式、当前任务页；未导航或切换客户端明暗', states: [], restored: false }
  let connections = [], main_connection, runtime, original
  try {
    const candidates = await discover_theme_processes()
    assert.ok(candidates.length, '未发现运行中的客户端，验收不会启动或重启 Codex')
    connections = await connect_inspector_theme(true)
    assert.equal(connections.length, 1, '本脚本限定当前单窗口；多窗口需独立验收，未执行换肤')
    const connection = connections[0]
    const [, pid, window_id] = connection.id.split(':').map(Number)
    assert.ok(pid && window_id, '本次实机验收需要经过验证的 Inspector 桥接')
    const candidate = (await discover_theme_processes()).find(item => item.pid === pid)
    assert.ok(candidate, '客户端进程身份发生变化')
    for (const port of candidate.ports) {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json()).catch(() => [])
      const target = targets.find(item => item.type === 'node' && new URL(item.webSocketDebuggerUrl).hostname === '127.0.0.1' && Number(new URL(item.webSocketDebuggerUrl).port) === port)
      if (!target) continue
      main_connection = await open_runtime_connection('complete-theme-screenshot', target.webSocketDebuggerUrl)
      assert.equal(await main_connection.evaluate('process.pid'), pid)
      break
    }
    assert.ok(main_connection, '未找到已验证的客户端主进程连接')
    report.client = await main_connection.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return {version:e.app.getVersion(),electron:process.versions.electron,chrome:process.versions.chrome,pid:process.pid,renderer:e.BrowserWindow.fromId(${window_id}).webContents.getOSProcessId()}})()`)
    const before = await connection.evaluate(`(()=>{if(!document.querySelector('.thread-scroll-container'))return null;window.__cm_complete_check={document,editor:document.querySelector('[contenteditable="true"]'),url:location.href};return {theme:window.__CODEX_DREAM_SKIN_STATE__?.themeId??null,mode:document.documentElement.dataset.originalMode,native_mode:document.documentElement.classList.contains('dark')?'dark':'light'}})()`)
    assert.ok(before, '当前不是任务页；未执行换肤')
    report.before = before
    // 独立备份目录不改写管理器中用户持久选择，所有主题应用仍通过生产事务实现。
    runtime = new ThemeRuntime(path.join(output, 'backups'), async () => connections.map(item => ({ id: item.id, evaluate: expression => item.evaluate(expression), close() {} })), path.join(root, 'resources'))
    const settings_file = path.join(process.env.APPDATA || '', 'Codex-Manager/theme-backups/settings.json')
    const motion = fs.existsSync(settings_file) ? JSON.parse(fs.readFileSync(settings_file, 'utf8')).motion_enabled : true
    await runtime.set_motion(typeof motion === 'boolean' ? motion : true)
    original = await runtime.backup()
    const ids = JSON.parse(fs.readFileSync(path.join(root, 'resources/skins/catalog.json'), 'utf8')).map(item => item.id)
    for (const id of ids) {
      report.stage = id + '/应用'
      await runtime.apply(id)
      await pause(400)
      report.stage = id + '/读取样式'
      const state = await connection.evaluate(`(async()=>{
        const style=getComputedStyle(document.documentElement),art=style.getPropertyValue('--original-art').trim();
        const url=art.match(/^url\\(["']?(.*?)["']?\\)$/)?.[1];const image=new Image();image.src=url||'';await image.decode();
        const node=document.querySelector('main.main-surface,main.dream-skin-main-surface'),r=node.getBoundingClientRect(),parts={};
        for(const part of ['titlebar','header','sidebar','conversation','composer','right-panel','menu','dialog','settings']){const n=document.querySelector('[data-cm-theme-part~="'+part+'"]');if(n){const s=getComputedStyle(n);parts[part]={background:s.backgroundColor,border:s.borderColor,radius:s.borderRadius}}}
        return {id:window.__CODEX_DREAM_SKIN_STATE__?.themeId,mode:document.documentElement.dataset.originalMode,document_kept:window.__cm_complete_check.document===document,editor_kept:window.__cm_complete_check.editor===document.querySelector('[contenteditable="true"]'),route_kept:window.__cm_complete_check.url===location.href,image:{width:image.naturalWidth,height:image.naturalHeight},background:getComputedStyle(node).backgroundImage,styles:document.querySelectorAll('#codex-original-theme-style').length,parts,clip:{x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}};
      })()`)
      assert.equal(state.id, id); assert.equal(state.mode, before.mode || before.native_mode)
      assert.ok(state.document_kept && state.editor_kept && state.route_kept, '客户端文档、编辑器或路由变化')
      assert.match(state.background, /blob:/); assert.equal(state.styles, 1)
      assert.ok(state.parts.sidebar && state.parts.composer, '真实侧栏或输入区未适配')
      // 仅保存任务主区域，避免把右侧文件编辑器纳入截图；不将任何正文写入诊断JSON。
      const capture = await main_connection.evaluate(`(async()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return (await e.BrowserWindow.fromId(${window_id}).webContents.capturePage(${JSON.stringify(state.clip)})).toJPEG(85).toString('base64')})()`)
      const screenshot = `${id}-${state.mode}-task-real.jpg`
      fs.writeFileSync(path.join(output, screenshot), Buffer.from(capture, 'base64'))
      report.states.push({ ...state, screenshot })
      console.log('真实任务页已检查：' + id)
    }
    await runtime.restore(original.id)
    report.restored = true
    const after = await connection.evaluate(`({theme:window.__CODEX_DREAM_SKIN_STATE__?.themeId??null,mode:document.documentElement.dataset.originalMode,document_kept:window.__cm_complete_check.document===document,editor_kept:window.__cm_complete_check.editor===document.querySelector('[contenteditable="true"]'),route_kept:window.__cm_complete_check.url===location.href})`)
    assert.equal(after.theme, before.theme); assert.equal(after.mode, before.mode)
    assert.ok(after.document_kept && after.editor_kept && after.route_kept)
    report.after = after; report.passed = true
  } catch (error) { report.error = String(error.stack); process.exitCode = 1 }
  finally {
    if (runtime && original && !report.restored) {
      try { await runtime.restore(original.id); report.restored = true }
      catch (error) { report.restore_error = String(error); process.exitCode = 1 }
    }
    for (const connection of connections) { await connection.evaluate('delete window.__cm_complete_check').catch(() => {}); connection.close() }
    main_connection?.close()
    await close_owned_inspectors()
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ passed: report.passed, restored: report.restored, count: report.states.length, error: report.error, output }))
  }
}
run().catch(error => { console.error('实机验收失败：', error); process.exitCode = 1 })
