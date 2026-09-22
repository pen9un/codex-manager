// 完整界面主题的隔离渲染、交互与尺寸验证；不连接真实Codex。
const { app, BrowserWindow } = require('electron')
const Module = require('node:module')
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const all_themes = process.argv.includes('--all')
const ids_argument = process.argv.find(value => value.startsWith('--ids='))?.slice(6)
const ids = ids_argument ? ids_argument.split(',') : all_themes ? JSON.parse(fs_sync.readFileSync(path.join(root, 'resources/skins/catalog.json'), 'utf8')).map(item => item.id) : ['fruit-base', 'lulu-duo', 'totoro-stop', 'zero-day']
const scale = process.argv.find(value => value.startsWith('--scale='))?.split('=')[1] || '1'
const quick = process.argv.includes('--quick')
const output_root = process.argv.find(value => value.startsWith('--output='))?.slice(9) || path.join(root, 'reports/theme-ui-samples-20260921')
const output = path.join(output_root, `visual-${scale}${quick ? '-quick' : ''}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const controls_expression = `(() => {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data]};
  const blend=(color,base)=>color.slice(0,3).map((v,i)=>v*color[3]/255+base[i]*(1-color[3]/255));
  const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4};
  const lum=v=>.2126*linear(v[0])+.7152*linear(v[1])+.0722*linear(v[2]);
  const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  const backgrounds=element=>{
    if(!element)return [[255,255,255]];
    const style=getComputedStyle(element);const base=backgrounds(element.parentElement);
    const colors=style.backgroundImage.match(/rgba?\\([^)]+\\)/g);
    if(colors?.length)return colors.flatMap(c=>base.map(b=>blend(rgba(c),b)));
    const fill=rgba(style.backgroundColor);return fill[3]===255?[fill.slice(0,3)]:base.map(b=>blend(fill,b));
  };
  const records=[];
  for(const element of document.querySelectorAll('[data-cm-theme-part~="button"],input,select')){
    if(element.matches(':disabled,[aria-disabled="true"]')||!element.checkVisibility({checkVisibilityCSS:true})||element.closest('[hidden]'))continue;
    const style=getComputedStyle(element),outside=backgrounds(element.parentElement),inside=backgrounds(element);
    const text=Math.min(...inside.map(b=>contrast(blend(rgba(style.color),b),b)));
    const borders=['Top','Right','Bottom','Left'].filter(side=>parseFloat(style['border'+side+'Width'])>0&&!['none','hidden'].includes(style['border'+side+'Style'])).map(side=>rgba(style['border'+side+'Color'])),fill=rgba(style.backgroundColor);
    const boundary=Math.min(...outside.map(b=>Math.max(contrast(blend(fill,b),b),...borders.map(border=>contrast(blend(border,b),b)))));
    const boundary_required=!element.matches('[data-cm-theme-part~="menu-item"],[data-cm-theme-part~="tab"],[data-cm-theme-part~="conversation"]:not([aria-current="page"]):not([aria-selected="true"])');
    records.push({label:(element.getAttribute('aria-label')||element.textContent||element.id).trim().slice(0,40),text,boundary,boundary_required});
  }
  return records;
})()`
app.commandLine.appendSwitch('force-device-scale-factor', scale)
app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', fs_sync.mkdtempSync(path.join(os.tmpdir(), 'theme-ui-samples-profile-')))

async function run() {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, reason: '本次检查尚未完成' }))
  const store = path.join(root, 'node_modules/.pnpm')
  const { buildSync } = require(path.join(store, fs_sync.readdirSync(store).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'))
  const bundled = buildSync({ entryPoints: [path.join(__dirname, 'theme_preview_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
  const engine_resource_hashes = {}
  for (const name of ['dream-skin.css', 'renderer-inject.js']) engine_resource_hashes[name] = sha(await fs.readFile(path.join(root, 'resources/theme-engine', name)))
  const compiled = new Module(__filename, module)
  compiled.filename = __filename; compiled.paths = module.paths; compiled._compile(bundled, __filename)
  const { render_skin_preview } = compiled.exports
  await app.whenReady()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-ui-samples-'))
  const preview_file = path.join(temporary, 'preview.html')
  const window = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, skipTaskbar: true, focusable: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const js = expression => window.webContents.executeJavaScript(expression, true)
  const capture = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { window.webContents.invalidate(); return (await window.webContents.capturePage()).toJPEG(92) }
      catch (error) { if (attempt === 3) throw error; await pause(250) }
    }
  }
  const errors = [], states = [], interactions = [], controls = [], without_art = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  const variants = new Map()
  for (const id of ids) for (const mode of ['light', 'dark']) for (const view of ['home', 'task', 'settings', 'components']) {
    const html = await render_skin_preview(id, mode, view, false, path.join(root, 'resources/skins'))
    await fs.writeFile(preview_file, html); await window.loadFile(preview_file)
    for (const [width, height] of quick ? [[1280, 800]] : [[1280, 800], [920, 650], [1920, 1080]]) {
      window.setContentSize(width, height); await pause(260)
      const state = await js(`(() => {
        const style = part => getComputedStyle(document.querySelector('[data-cm-theme-part~="'+part+'"]'));
        return {id:document.documentElement.dataset.originalTheme,mode:document.documentElement.dataset.originalMode,
          overflow:document.documentElement.scrollWidth>innerWidth+1,
          main_overflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1,
          part_count:document.querySelectorAll('[data-cm-theme-part]').length,
          paused:document.querySelector('#codex-original-motion').dataset.paused,
          sidebar:style('sidebar').background, titlebar:style('titlebar').background,
          radius:getComputedStyle(document.querySelector('.preview-nav button')).borderRadius,
          theme_radius:getComputedStyle(document.documentElement).getPropertyValue('--cm-radius'),
          theme_sidebar:getComputedStyle(document.documentElement).getPropertyValue('--cm-sidebar'),
          selected:style('conversation').boxShadow, task_background:getComputedStyle(document.querySelector('main')).backgroundImage};
      })()`)
      assert.equal(state.id, id); assert.equal(state.mode, mode)
      assert.equal(state.overflow, false, `${id}/${mode}/${view}/${width} 页面溢出`)
      assert.equal(state.main_overflow, false, `${id}/${mode}/${view}/${width} 主区域溢出`)
      assert.ok(state.part_count > 20, `${id} 未挂载完整组件标记`)
      assert.equal(state.paused, 'true')
      if (view === 'home' || view === 'task') assert.match(state.task_background, /blob:/, `${id}/${mode}/${width} 主图必须显示`)
      const recipe = await fs.readFile(path.join(root, 'scripts/theme_ui_samples', id + '.css'), 'utf8')
      const expected_radius = recipe.match(/--cm-radius:\s*([^;]+);/)[1].trim()
      assert.equal(state.theme_radius.trim(), expected_radius, '主题组件规则必须完整解析')
      if (view === 'settings' || view === 'components') assert.equal(state.task_background, 'none')
      if (view === 'home') variants.set(id, [state.sidebar, state.titlebar, state.radius, state.selected].join('|'))
      const filename = `${id}-${mode}-${view}-${width}.jpg`
      const image = await capture()
      await fs.writeFile(path.join(output, filename), image)
      states.push({ id, mode, view, width, height, ...state, screenshot: filename, sha256: sha(image) })
      if(width===1280){const metrics=await js(controls_expression);controls.push({id,mode,view,metrics});
        for(const metric of metrics){assert.ok(metric.text>=4.5, JSON.stringify({id,mode,view,metric,reason:'控件文字对比度'}));if(metric.boundary_required)assert.ok(metric.boundary>=3,JSON.stringify({id,mode,view,metric,reason:'控件边界对比度'}));}}
      if (view === 'home' && width === 1280) {
        await js(`(()=>{const style=document.createElement('style');style.id='preview-hide-art';style.textContent='html'+('[data-original-theme]'.repeat(10))+' main.dream-skin-home-shell{background-image:none!important}';document.head.appendChild(style)})()`)
        await pause(70)
        const comparison_filename = `${id}-${mode}-without-art.jpg`
        const comparison_image = await capture()
        await fs.writeFile(path.join(output, comparison_filename), comparison_image)
        without_art.push({ id, mode, screenshot: comparison_filename, sha256: sha(comparison_image) })
        await js(`document.querySelector('#preview-hide-art').remove()`)
        await pause(70)
        assert.ok(await js(`/blob:/.test(getComputedStyle(document.querySelector('main')).backgroundImage)`), '无图对比不能污染后续截图')
      }
    }
    if (view === 'components') {
      const result = await js(`(() => {
        const opener=document.querySelector('[data-open="state-dialog"]');
        document.querySelector('[data-close="state-dialog"]').click();
        const closed=document.querySelector('#state-dialog').hidden;
        opener.click();const opened=!document.querySelector('#state-dialog').hidden;
        const focused=document.activeElement.closest('#state-dialog')!==null;
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        const returned=document.activeElement===opener;
        const menu_opener=document.querySelector('[data-open="state-menu"]');menu_opener.click();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
        const moved=document.activeElement===document.querySelectorAll('#state-menu [role="menuitem"]')[1];
        document.activeElement.click();
        return {closed,opened,focused,returned,moved,menu_closed:document.querySelector('#state-menu').hidden};
      })()`)
      assert.ok(Object.values(result).every(Boolean), JSON.stringify(result))
      interactions.push({ id, mode, view, ...result })
    }
    if (view === 'settings') {
      const result = await js(`(() => {const button=document.querySelector('[role="switch"]');const before=button.getAttribute('aria-checked');button.click();return {changed:before!==button.getAttribute('aria-checked')}})()`)
      assert.equal(result.changed, true); interactions.push({ id, mode, view, ...result })
    }
    console.log(`已检查完整样板：${id} ${mode} ${view}`)
  }
  assert.equal(new Set(variants.values()).size, ids.length, '各组组件不能只有背景图区别')
  assert.deepEqual(errors, [])
  const runtime_hashes = {}
  for(const id of ids) for(const name of ['theme.json','original.css','hero-light.webp','hero-dark.webp']) runtime_hashes[`${id}/${name}`]=sha(await fs.readFile(path.join(root,'resources/skins',id,name)))
  for (const [name, hash] of Object.entries(engine_resource_hashes)) assert.equal(sha(await fs.readFile(path.join(root, 'resources/theme-engine', name))), hash, '验收过程中引擎资源发生变化')
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, type: '隔离Electron模拟预览，非真实Codex', scale, engine_bundle_sha256:sha(bundled), engine_resource_hashes, runtime_hashes, states, without_art, controls, interactions, errors }, null, 2))
  window.destroy(); await fs.unlink(preview_file); await fs.rmdir(temporary)
  console.log(JSON.stringify({ passed: true, screenshots: states.length + ids.length * 2, interactions: interactions.length, output }))
  app.exit(0)
}
run().catch(error => { console.error('完整界面样板验收失败：', error); app.exit(1) })
