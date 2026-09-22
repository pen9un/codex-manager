// 用实际主题预览验证明暗任务页背景、阅读底色、首页和卸载，不连接真实客户端。
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'theme-task-art-')))
protocol.registerSchemesAsPrivileged([{ scheme: 'themetest', privileges: { standard: true, secure: true } }])
const store = path.join(root, 'node_modules/.pnpm')
const esbuild = require(path.join(store, fs.readdirSync(store).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'))
const compiled = new Module(__filename, module)
compiled.filename = __filename; compiled.paths = module.paths
compiled._compile(esbuild.buildSync({ entryPoints: [path.join(__dirname, 'theme_preview_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename)
async function main() {
  await app.whenReady()
  let preview_html = ''
  protocol.handle('themetest', () => new Response(preview_html, { headers: { 'content-type': 'text/html;charset=utf-8' } }))
  const window = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: true } })
  const results = []
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'resources/skins/catalog.json'), 'utf8'))
  for (const { id } of catalog) for (const mode of ['light', 'dark']) {
    preview_html = await compiled.exports.render_skin_preview(id, mode, 'task', false, path.join(root, 'resources/skins'))
    await window.loadURL('themetest://preview/' + id + '/' + mode)
    const state = await window.webContents.executeJavaScript(`(async()=>{
      const surface=document.querySelector('.thread-scroll-container');
      const bg=getComputedStyle(surface.closest('main')).backgroundImage;
      const art=getComputedStyle(document.documentElement).getPropertyValue('--original-art').trim();
      const img=new Image();img.src=art.match(/^url\\(["']?(.*?)["']?\\)$/)[1];await img.decode();
      const message=surface.querySelector('article');
      return {background:bg,thread_background:getComputedStyle(surface).backgroundColor,image_width:img.naturalWidth,message_background:getComputedStyle(message).backgroundColor,home:!!document.querySelector('main.dream-skin-home-shell'),motion_paused:document.querySelector('#codex-original-motion')?.dataset.paused,overflow:document.documentElement.scrollWidth>innerWidth};
    })()`)
    assert.match(state.background, /blob:/, id + ' ' + mode + ' 任务页必须绘制主题主图')
    assert.equal(state.thread_background, 'rgba(0, 0, 0, 0)', '滚动容器不能遮住工作区背景')
    assert.ok(state.image_width > 0)
    assert.notEqual(state.message_background, 'rgba(0, 0, 0, 0)', '正文必须保持阅读底色')
    assert.equal(state.home, false); assert.equal(state.motion_paused, 'true'); assert.equal(state.overflow, false)
    results.push({ id, mode, ...state })
    if (id === 'fruit-base') {
      const turn_state = await window.webContents.executeJavaScript(`(()=>{
        const turn=document.createElement('div');turn.dataset.turnKey='isolated-check';
        turn.innerHTML='<div data-content-search-turn-key="check" style="display:contents"><div data-markdown-text-style="assistant-message">真实容器结构中的中文摘要</div><button>查看执行过程</button></div>';
        document.querySelector('.thread-scroll-container').appendChild(turn);
        const style=getComputedStyle(turn);const result={background:style.backgroundColor,image:style.backgroundImage,position:style.position,width:turn.getBoundingClientRect().width};turn.remove();return result;
      })()`)
      assert.equal(turn_state.background, state.message_background, '真实轮次容器的正文和活动摘要必须保持相同阅读底色')
      assert.equal(turn_state.image, 'none'); assert.equal(turn_state.position, 'static'); assert.ok(turn_state.width > 0)
      for (const [width, height] of [[920, 650], [1280, 800], [1920, 1080]]) {
        window.setContentSize(width, height)
        await new Promise(resolve => setTimeout(resolve, 80))
        assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth'), false, '窄窗口不能产生横向溢出')
        const output = path.join(root, 'reports/theme-background-fix-20260921')
        fs.mkdirSync(output, { recursive: true })
        fs.writeFileSync(path.join(output, `task-${mode}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
      window.setContentSize(1280, 800)
    }
    await window.webContents.executeJavaScript('window.__CODEX_DREAM_SKIN_STATE__.cleanup();true')
    assert.equal(await window.webContents.executeJavaScript('!!document.querySelector("#codex-original-theme-style")'), false)
  }
  for (const mode of ['light', 'dark']) {
    preview_html = await compiled.exports.render_skin_preview('fruit-base', mode, 'home', false, path.join(root, 'resources/skins'))
    await window.loadURL('themetest://preview/home/' + mode)
    assert.match(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector("main.dream-skin-home-shell")).backgroundImage'), /blob:/, '首页主图不能受任务页修复影响')
  }
  fs.writeFileSync(path.join(root, 'reports/任务页背景隔离验收-20260921.json'), JSON.stringify({ passed: true, results }, null, 2))
  console.log('任务页明暗背景验收通过：' + results.length + ' 个外观')
  window.destroy()
}
main().then(() => app.exit(0)).catch(error => { console.error('任务页背景验收失败：', error); app.exit(1) })
