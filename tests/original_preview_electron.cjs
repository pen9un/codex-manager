// 使用真实 Electron 渲染隔离预览，验证 DOM 识别、双图和配色，不连接用户客户端。
const { app, BrowserWindow, nativeTheme } = require('electron')
const Module = require('node:module')
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
app.setPath('userData', fs_sync.mkdtempSync(path.join(os.tmpdir(), 'original-preview-profile-')))

const package_store = path.resolve(__dirname, '../node_modules/.pnpm')
const esbuild_package = fs_sync.readdirSync(package_store).find(name => name.startsWith('esbuild@'))
if (!esbuild_package) throw new Error('缺少 Electron 预览测试所需的 esbuild')
const { buildSync } = require(path.join(package_store, esbuild_package, 'node_modules/esbuild'))

const bundle = buildSync({ entryPoints: [path.join(__dirname, 'theme_preview_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
const compiled = new Module(path.join(__dirname, 'original_preview_electron_compiled.cjs'), module)
compiled.filename = path.join(__dirname, 'original_preview_electron_compiled.cjs')
compiled.paths = module.paths
compiled._compile(bundle, compiled.filename)
const { build_skin_payload, render_skin_preview } = compiled.exports
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const skins_root = path.resolve(__dirname, '../resources/skins')
const engine_root = path.resolve(__dirname, '../resources/theme-engine')

async function inspect(window, id, mode, view, motion_enabled, output) {
  const html = await render_skin_preview(id, mode, view, motion_enabled, skins_root)
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  window.show(); window.focus(); await pause(700)
  await pause(80)
  const state = await read_state(window)
  state.style_mutations = await window.webContents.executeJavaScript(`new Promise(resolve => {let count=0;const observer=new MutationObserver(items=>{count+=items.filter(item=>item.attributeName==='style').length});observer.observe(document.documentElement,{attributes:true,attributeFilter:['style']});setTimeout(()=>{observer.disconnect();resolve(count)},450)})`)
  await fs.writeFile(path.join(output, `${id}-${mode}-${view}.png`), (await window.webContents.capturePage()).toPNG())
  return state
}

async function read_state(window) {
  return window.webContents.executeJavaScript(`(() => {
    const root=document.documentElement, main=document.querySelector('main'), body=getComputedStyle(document.body);
    return {
      theme:root.dataset.dreamTheme, shell:root.dataset.dreamShell, mode:root.dataset.originalMode,
      home:main?.classList.contains('dream-skin-home-shell'), home_surface:!!document.querySelector('.dream-skin-home'),
      main_background:getComputedStyle(main).backgroundImage,
      original_art:root.style.getPropertyValue('--original-art'), base_art:window.__CODEX_DREAM_SKIN_STATE__?.artUrl || '',
      background:body.backgroundImage, background_color:body.backgroundColor, font:body.fontFamily,
      palette:getComputedStyle(root).getPropertyValue('--ds-bg').trim(),
      motion_paused:document.getElementById('codex-original-motion')?.dataset.paused,
      motion:document.getElementById('codex-original-motion')?.dataset.motion,
      original_style:!!document.getElementById('codex-original-theme-style'),
      navigation: (()=>{const button=document.querySelector('.preview-nav button');return button?{background:getComputedStyle(button).background,color:getComputedStyle(button).color,rules:[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>rule.selectorText&&button.matches(rule.selectorText)&&rule.style?.background).map(rule=>({selector:rule.selectorText,background:rule.style.background}))}:null})(),
    };
  })()`)
}

async function inspect_explicit_light_under_dark_system(window, output) {
  nativeTheme.themeSource = 'dark'
  const payload = await build_skin_payload('fruit-base', false, skins_root, engine_root)
  const html = `<!doctype html><html class="light" data-theme="light" data-appearance="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'"><style>html,body{margin:0;min-height:100%}.group\\/home-suggestions{display:block}main{min-height:600px}</style></head><body><aside class="app-shell-left-panel"><button>Codex</button></aside><main class="main-surface" role="main"><div role="main"><div class="group/home-suggestions"><button>测试建议</button></div><div class="composer-surface-chrome"><div contenteditable="true">输入区</div></div></div></main><script>${payload.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  window.show(); window.focus(); await pause(700)
  const state = await read_state(window)
  await fs.writeFile(path.join(output, 'fruit-base-light-system-dark.png'), (await window.webContents.capturePage()).toPNG())
  nativeTheme.themeSource = 'system'
  return state
}

async function run() {
  const output = path.resolve(__dirname, '../reports/theme-v2-final-preview-20260920')
  await fs.mkdir(output, { recursive: true })
  await app.whenReady()
  const errors = []
  const window = new BrowserWindow({ width: 1180, height: 760, show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } })
  window.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 'warning') errors.push(event.message) })
  const dark = await inspect(window, 'fruit-base', 'dark', 'home', true, output)
  const light = await inspect(window, 'fruit-base', 'light', 'home', false, output)
  const task = await inspect(window, 'fruit-base', 'dark', 'task', true, output)
  const motion = await inspect(window, 'orbital-harbor', 'dark', 'home', true, output)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] })
  await pause(150)
  assert.equal((await read_state(window)).motion_paused,'true','系统减少动态效果必须优先')
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'no-preference'}] })
  window.webContents.debugger.detach()
  window.hide(); await pause(150)
  assert.equal((await read_state(window)).motion_paused,'true','隐藏窗口必须暂停动效')
  window.show();window.focus();await pause(150)
  await window.webContents.executeJavaScript(`window.__CODEX_ORIGINAL_THEME_STATE__.setMotion(false)`)
  assert.equal((await read_state(window)).motion_paused,'true','关闭动效不能继续播放')
  const explicit_light = await inspect_explicit_light_under_dark_system(window, output)
  const live_modes = []
  for (const next_mode of ['dark','light']) {
    await window.webContents.executeJavaScript(`document.documentElement.classList.remove('light','dark');document.documentElement.classList.add('${next_mode}');document.documentElement.dataset.theme='${next_mode}';document.documentElement.dataset.appearance='${next_mode}'`)
    await pause(500)
    const state = await read_state(window)
    assert.equal(state.mode,next_mode,'同一页面的主图必须跟随客户端明暗切换')
    assert.equal(state.shell,next_mode,'同一页面的配色必须跟随客户端明暗切换')
    live_modes.push(state)
  }
  await window.webContents.executeJavaScript(`document.documentElement.classList.remove('light','dark');document.documentElement.dataset.theme='system';document.documentElement.dataset.appearance='system'`)
  for(const next_mode of ['dark','light']) {
    nativeTheme.themeSource=next_mode;await pause(500)
    const state=await read_state(window)
    assert.equal(state.mode,next_mode,'系统明暗变化必须切换主图')
    assert.equal(state.shell,next_mode,'系统明暗变化必须切换配色')
    live_modes.push(state)
  }
  nativeTheme.themeSource='system'
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ dark, light, task, motion, explicit_light, live_modes,reduced_motion:true,hidden_pauses:true,motion_off:true,errors }, null, 2))
  assert.equal(dark.home, true, '首页必须被原引擎识别')
  assert.match(dark.main_background, /blob:/, '首页主区必须绘制真实主题主图')
  assert.equal(dark.mode, 'dark')
  assert.notEqual(dark.original_art, dark.base_art, '深色模式必须使用深色主图')
  assert.equal(light.mode, 'light')
  assert.match(light.original_art, /blob:/)
  assert.equal(task.home, false, '任务页不得作为首页处理')
  assert.equal(task.motion_paused, 'true', '任务页环境动效必须暂停')
  assert.equal(motion.motion, 'orbit')
  assert.equal(motion.motion_paused, 'false', '首页聚焦且允许动效时必须播放环境动效')
  assert.equal(explicit_light.mode, 'light', 'HTML 明确 light 时不能被系统深色覆盖')
  assert.equal(explicit_light.original_art, `url("${explicit_light.base_art}")`, 'HTML 明确 light 时必须使用浅色主图')
  assert.ok(dark.background_color !== light.background_color, '正文底色必须随明暗配色切换')
  assert.ok(dark.font && light.font, '正文必须保留可计算字体')
  assert.ok(dark.style_mutations < 8 && light.style_mutations < 8, '主题同步不能持续触发 style 观察循环')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ success: true, output, dark, light, task, motion, explicit_light }))
  window.destroy(); app.exit(0)
}
run().catch(error => { nativeTheme.themeSource = 'system'; console.error('主题馆第二版预览验证失败：', error); app.exit(1) })
