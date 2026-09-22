// 用应用的同一引擎生成全主题截图，并验证模式、阅读页和资源生命周期。
const { app, BrowserWindow } = require('electron')
const Module = require('node:module')
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const scale = process.argv.find(x=>x.startsWith('--scale='))?.split('=')[1] || '1'
app.commandLine.appendSwitch('force-device-scale-factor', scale)
const engine_sources = [
  'tests/theme_preview_electron_entry.ts', 'src/main/themes.ts', 'src/main/theme_preview.ts', 'src/main/original_engine.ts',
  ...['payload','normalize','home-detection','constants','compiler'].map(name=>`src/main/vendor/codex-themes/engine/${name}.ts`),
  'src/main/vendor/codex-themes/shared/tone.ts',
  'resources/theme-engine/dream-skin.css', 'resources/theme-engine/renderer-inject.js',
]
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
async function resource_hashes(ids) {
  const files = [...engine_sources]
  for(const id of ids) {
    const directory = `resources/skins/${id}`
    const names = await fs.readdir(path.join(root,directory),{withFileTypes:true})
    for(const entry of names) if(entry.isFile() && !['preview-light.webp','preview-dark.webp','provenance.json'].includes(entry.name)) files.push(`${directory}/${entry.name}`)
    for(const required of ['theme.json','original.css','hero-light.webp','hero-dark.webp']) assert.ok(files.includes(`${directory}/${required}`),`缺少验收运行资源：${id}/${required}`)
  }
  const hashes = {}
  for(const file of files.sort()) hashes[file] = sha256(await fs.readFile(path.join(root,file)))
  return hashes
}
async function run() {
  const ids_argument = process.argv.find(value=>value.startsWith('--ids='))
  const requested_ids = ids_argument ? ids_argument.slice('--ids='.length).split(',') : null
  const output = path.join(root,'reports',`theme-v2-final-visual-${scale}${!requested_ids || requested_ids.length===20?'':'-selected'}`)
  await fs.mkdir(output,{recursive:true})
  // 编译、资源读取或截图任一步失败，都不能留下上次的通过结论。
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,scale,reason:'本次验收尚未完成'},null,2))
  const isolated_profile = fs_sync.mkdtempSync(path.join(os.tmpdir(),'original-visual-profile-'))
  app.setPath('userData',isolated_profile)
  const skins_root = path.join(root,'resources/skins'), engine_root = path.join(root,'resources/theme-engine')
  const catalog = JSON.parse(await fs.readFile(path.join(skins_root,'catalog.json'),'utf8'))
  assert.equal(catalog.length,20,'最终目录应有20组主题')
  const ids = requested_ids || catalog.map(entry=>entry.id)
  assert.ok(ids.length>0 && ids.every(id=>id && catalog.some(entry=>entry.id===id)),'--ids 必须指定目录中的主题 ID，以逗号分隔')
  assert.equal(new Set(ids).size,ids.length,'--ids 不得重复指定主题')
  const selected_catalog = ids.map(id=>catalog.find(entry=>entry.id===id))
  const full_catalog = selected_catalog.length===catalog.length
  const input_hashes = await resource_hashes(ids)
  const store = path.join(root, 'node_modules/.pnpm')
  const { buildSync } = require(path.join(store, fs_sync.readdirSync(store).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'))
  const bundled = buildSync({ entryPoints:[path.join(__dirname,'theme_preview_electron_entry.ts')],bundle:true,platform:'node',format:'cjs',write:false }).outputFiles[0].text
  const compiled = new Module(__filename, module)
  compiled.filename = __filename; compiled.paths = module.paths; compiled._compile(bundled, __filename)
  const { render_skin_preview, build_skin_payload } = compiled.exports
  await app.whenReady()
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'original-visual-'))
  const preview_file = path.join(temp,'preview.html')
  const window = new BrowserWindow({width:1280,height:800,show:false,opacity:0,skipTaskbar:true,focusable:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  window.showInactive()
  const errors = [], states = []
  window.webContents.on('console-message', event=>{if(event.level==='error')errors.push(event.message)})
  const js = code=>window.webContents.executeJavaScript(code,true)
  for(const entry of selected_catalog) for(const mode of ['light','dark']) for(const view of ['home','task']) {
    const html = await render_skin_preview(entry.id,mode,view,false,skins_root)
    await fs.writeFile(preview_file,html)
    await window.loadFile(preview_file)
    for(const [width,height] of [[1280,800],[920,650],[1920,1080]]) {
      window.setContentSize(width,height); await pause(400)
      const state = await js(`({id:document.documentElement.dataset.originalTheme,mode:document.documentElement.dataset.originalMode,home:!!document.querySelector('main.dream-skin-home-shell'),overflow:document.documentElement.scrollWidth>innerWidth+1,paused:document.querySelector('#codex-original-motion')?.dataset.paused,background:getComputedStyle(document.querySelector('main')).backgroundImage,font:getComputedStyle(document.body).fontFamily})`)
      assert.equal(state.id,entry.id);assert.equal(state.mode,mode);assert.equal(state.home,view==='home');assert.equal(state.overflow,false,`${entry.id}/${mode}/${view}/${width}横向溢出`);assert.equal(state.paused,'true')
      if(view==='task')assert.equal(state.background,'none','任务页应使用实色阅读底色')
      if(view==='home' && ['fruit-base','lulu-duo','totoro-stop','zero-day','chiikawa-camp','labubu-forest','sea-train','cloud-castle','pixel-studio','crystal-core','neon-rider'].includes(entry.id)) {
        assert.ok(!state.background.includes('gradient('),'新样板首页不能被基础引擎的大面积遮罩覆盖')
        assert.equal(await js(`getComputedStyle(document.querySelector('main')).backgroundSize`),'100%','主图应完整横向展示，避免裁掉双角色')
      }
      const filename = `${entry.id}-${mode}-${view}-${width}.jpg`
      const screenshot = (await window.webContents.capturePage()).toJPEG(92)
      await fs.writeFile(path.join(output,filename),screenshot)
      states.push({id:entry.id,mode,view,width,height,...state,screenshot:filename,screenshot_sha256:sha256(screenshot)})
    }
    console.log(`已检查：${entry.id} ${mode} ${view}`)
  }
  // 同一个文档连续注入30次，统计真实创建与回收的blob、监听器和间隔定时器。
  await window.loadURL('data:text/html,<html><head><style>body{font-family:Georgia}code{font-family:Consolas;font-size:19px}</style></head><body><main class="main-surface"><div role="main"><div class="group/home-suggestions"><button>测试</button></div><code>const value=1</code></div></main></body></html>')
  await js(`(()=>{window.resourceAudit={blobs:new Set(),intervals:new Set(),listeners:[]};const a=window.resourceAudit;const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);a.blobs.add(u);return u};URL.revokeObjectURL=u=>{a.blobs.delete(u);return revoke(u)};const si=window.setInterval,ci=window.clearInterval;window.setInterval=(...args)=>{const id=si(...args);a.intervals.add(id);return id};window.clearInterval=id=>{a.intervals.delete(id);return ci(id)};for(const target of [window,document]){const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);target.addEventListener=(type,fn,...rest)=>{if(!a.listeners.some(x=>x.target===target&&x.type===type&&x.fn===fn))a.listeners.push({target,type,fn});return add(type,fn,...rest)};target.removeEventListener=(type,fn,...rest)=>{a.listeners=a.listeners.filter(x=>!(x.target===target&&x.type===type&&x.fn===fn));return remove(type,fn,...rest)}}})()`)
  const cycles = []
  for(let index=0;index<30;index++) {
    await js(await build_skin_payload(selected_catalog[index%selected_catalog.length].id,index%2===0,skins_root,engine_root))
    const metrics=await js(`({blobs:resourceAudit.blobs.size,intervals:resourceAudit.intervals.size,listeners:resourceAudit.listeners.length,styles:document.querySelectorAll('#codex-original-theme-style').length,motion:document.querySelectorAll('#codex-original-motion').length,font:getComputedStyle(document.body).fontFamily,code:getComputedStyle(document.querySelector('code')).fontSize})`)
    assert.ok(metrics.blobs>=2&&metrics.blobs<=3,'主图、备用明暗图及基础引擎标记图最多占用3个blob');assert.equal(metrics.styles,1);assert.equal(metrics.motion,1);assert.equal(metrics.font,'Georgia');assert.equal(metrics.code,'19px')
    cycles.push(metrics)
  }
  assert.equal(await js(`document.body.style.fontFamily='Verdana';getComputedStyle(document.body).fontFamily`),'Verdana','挂载期间修改字体偏好应立即生效')
  await js(`document.body.style.removeProperty('font-family');window.__CODEX_DREAM_SKIN_STATE__.cleanup()`)
  const cleanup=await js(`({blobs:resourceAudit.blobs.size,intervals:resourceAudit.intervals.size,listeners:resourceAudit.listeners.length,styles:document.querySelectorAll('#codex-original-theme-style').length,motion:document.querySelectorAll('#codex-original-motion').length,font:getComputedStyle(document.body).fontFamily})`)
  assert.deepEqual(cleanup,{blobs:0,intervals:0,listeners:0,styles:0,motion:0,font:'Georgia'})
  assert.ok(cycles.every(x=>x.blobs===cycles[0].blobs&&x.intervals===cycles[0].intervals&&x.listeners===cycles[0].listeners),'连续切换不能累积图片、监听器或定时器')
  assert.deepEqual(errors,[])
  assert.deepEqual(await resource_hashes(ids),input_hashes,'验收期间运行资源或预览引擎源码发生变化，请重新验收')
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,scale,ids,full_catalog,catalog_count:catalog.length,input_hashes,states,cycles,cleanup,errors},null,2))
  console.log(JSON.stringify({passed:true,scale,ids,full_catalog,screenshots:states.length,cycles:cycles.length,output}))
  window.destroy();await fs.unlink(preview_file);await fs.rmdir(temp);app.exit(0)
}
run().catch(error=>{console.error('主题馆第二版视觉验收失败：',error);app.exit(1)})
