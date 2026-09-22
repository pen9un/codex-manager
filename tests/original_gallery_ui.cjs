// 在隔离用户目录运行真实应用，验证主题馆的展示和操作。
const { app, BrowserWindow, nativeTheme } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const scale = process.argv.find(value => value.startsWith('--scale='))?.split('=')[1] || '1'
const samples = process.argv.includes('--samples')
const packaged = process.argv.includes('--packaged')
const release_argument = process.argv.find(value => value.startsWith('--release-dir='))?.slice('--release-dir='.length)
if (release_argument) assert.ok(path.isAbsolute(release_argument), '--release-dir 必须是绝对路径')
const expected_ids = ['fruit-base','lulu-duo','chiikawa-camp','labubu-forest','totoro-stop','sea-train','cloud-castle','pixel-studio','crystal-core','zero-day','neon-rider','pine-retreat','tidal-letter','ink-landscape','orbital-harbor','neon-rain','floating-courier','cloud-cottage','skyward-journal','moonlit-serenade']
const upgraded_ids = expected_ids
let result_path
let current_step = '启动应用'
const step = label => { current_step = label; console.log(`验收步骤：${label}`) }
async function bounded(work, label) {
  let timer
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${current_step}：${label} 超过15秒未完成`), { code: 'GALLERY_COMMAND_TIMEOUT' })), 15000)
    })])
  } finally { clearTimeout(timer) }
}
const frame_js = (frame, code) => bounded(frame.executeJavaScript(code), `子框架脚本 ${code.slice(0,120)}`)
const loading_result = error => { if (error.code === 'GALLERY_COMMAND_TIMEOUT') throw error; return null }
app.commandLine.appendSwitch('force-device-scale-factor', scale)
async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'original-gallery-'))
  const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) || (samples
    ? path.join(root, 'reports', 'theme-ui-samples-20260921', `gallery-${packaged ? 'packaged' : scale}`)
    : path.join(root, 'reports', `theme-v2-final-gallery-${packaged ? 'packaged' : scale}`))
  await fs.mkdir(output, { recursive: true })
  result_path = path.join(output,'result.json')
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,scale,reason:'本次验收尚未完成'},null,2))
  await fs.mkdir(path.join(sandbox, '.codex'))
  process.env.CODEX_HOME = path.join(sandbox, '.codex')
  delete process.env.ELECTRON_RENDERER_URL
  os.homedir = () => sandbox
  app.setPath('appData', sandbox)
  require('node:child_process').execFile = (...args) => { args.at(-1)(null, '[]', ''); return {} }
  const errors = []
  const loaded_frames = new Set()
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    contents.on('render-process-gone', (_event, details) => {
      const message = `渲染进程退出：${JSON.stringify({step:current_step,...details})}`
      errors.push(message); console.error(message)
    })
    contents.on('did-frame-finish-load', (_event, is_main_frame, process_id, routing_id) => {
      if (!is_main_frame) {
        loaded_frames.add(`${process_id}:${routing_id}`)
        console.log(`子框架加载完成：${current_step}，进程 ${process_id}，路由 ${routing_id}`)
      }
    })
  })
  const release_directory = samples ? 'theme-ui-samples-20260921' : 'theme-v2-final'
  const release_root = release_argument || path.join(root, 'releases', release_directory)
  const main_bundle = packaged ? path.join(release_root, 'win-unpacked', 'resources', 'app.asar', 'out', 'main', 'index.js') : path.join(root, 'out/main/index.js')
  require(main_bundle)
  await app.whenReady()
  let window
  for (let index = 0; index < 100; index++) {
    window = BrowserWindow.getAllWindows()[0]
    if (window && !window.webContents.isLoading()) break
    await pause(100)
  }
  assert.ok(window, '应用窗口必须创建')
  const js = code => bounded(window.webContents.executeJavaScript(code, true), `主框架脚本 ${code.slice(0,120)}`)
  // 切换会销毁旧 iframe；只向新建且加载完成的框架发送脚本，避免等待已失效的执行上下文。
  const frame_ids = () => new Set(window.webContents.mainFrame.frames.map(frame => frame.frameTreeNodeId))
  const loaded_preview = previous_ids => window.webContents.mainFrame.frames.find(frame =>
    !frame.isDestroyed() && frame.url === 'about:srcdoc' && !previous_ids.has(frame.frameTreeNodeId) && loaded_frames.has(`${frame.processId}:${frame.routingId}`))
  for (let index = 0; index < 60; index++) {
    if (await js(`!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='主题')`)) break
    await pause(100)
  }
  await js(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='主题').click()`)
  await pause(1500)
  assert.equal(await js(`document.querySelector('.skin-page h1')?.textContent`), '主题馆')
  for (let index = 0; index < 100; index++) {
    if (await js(`document.querySelectorAll('.original-card').length>0`)) break
    await pause(100)
  }
  const count = await js(`document.querySelectorAll('.original-card').length`)
  assert.equal(count, 20, '最终目录必须展示20组主题')
  assert.equal(await js(`!!document.querySelector('.original-intro')`), false, '主题馆不应出现统一原创介绍')
  const source_labels = await js(`[...document.querySelectorAll('.original-card-topline')].map(element=>element.textContent)`)
  for (const label of ['原创作品','IP再创作','用户提供角色']) assert.ok(source_labels.some(text=>text.includes(label)), `卡片必须显示来源：${label}`)
  assert.equal(await js(`document.querySelector('.skin-page').textContent.includes('Dream Skin')`), false)
  await js(`document.querySelector('[aria-label="深色预览"]').click()`)
  await js(`document.querySelector('.original-card-preview').focus();document.querySelector('.original-card-preview').click()`)
  await pause(1700)
  assert.equal(await js(`!!document.querySelector('iframe[title*="界面预览"]')`), true)
  await js(`document.querySelector('[aria-label="任务页预览"]').click()`)
  await pause(700)
  window.setContentSize(920,650);window.show();window.focus()
  await js(`document.querySelector('iframe').contentWindow.focus()`)
  const task_frame = window.webContents.mainFrame.frames.find(frame=>frame.url==='about:srcdoc')
  assert.ok(task_frame,'隔离预览必须创建真实子框架')
  const scroll_state = await frame_js(task_frame, `(()=>{const main=document.querySelector('main');if(main&&main.scrollHeight>main.clientHeight){main.scrollTop=main.scrollHeight}else{window.scrollTo(0,document.body.scrollHeight)}return {main_scroll:main?.scrollTop||0,window_scroll:scrollY}})()`)
  assert.ok(scroll_state.main_scroll > 0 || scroll_state.window_scroll > 0,'小窗口任务预览的 main 或旧版窗口必须能够滚动')
  await fs.writeFile(path.join(output,'detail-task-920.png'),(await window.webContents.capturePage()).toPNG())
  const task_focus = await frame_js(task_frame, `(()=>{const nodes=[...document.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');nodes.at(-1)?.focus();return {count:nodes.length,last:document.activeElement?.tagName}})()`)
  assert.ok(task_focus.count > 0 && task_focus.last, '任务预览必须存在可见可聚焦元素')
  await window.webContents.sendInputEvent({ type:'keyDown',keyCode:'Tab' })
  await window.webContents.sendInputEvent({ type:'keyUp',keyCode:'Tab' })
  await pause(100)
  assert.equal(await js(`document.activeElement.tagName==='IFRAME'`),false,'从预览最后一个可见可聚焦元素按Tab必须返回父模态控件')
  await js(`document.querySelector('iframe').contentWindow.focus()`)
  await window.webContents.sendInputEvent({ type:'keyDown',keyCode:'Escape' })
  await pause(150)
  assert.equal(await js(`!!document.querySelector('.original-preview-modal')`), false)
  assert.equal(await js(`document.activeElement.classList.contains('original-card-preview')`), true)
  const previews=[]
  const extended_previews=[]
  for(let index=0;index<count;index++) {
    step(`${index+1}/${count} ${expected_ids[index]} 首页`)
    const previous_home_frames = frame_ids()
    await js(`document.querySelectorAll('.original-card-preview')[${index}].focus();document.querySelectorAll('.original-card-preview')[${index}].click()`)
    let frame
    for(let attempt=0;attempt<60;attempt++) {
      frame=loaded_preview(previous_home_frames)
      if(frame&&await frame_js(frame, `!!document.documentElement?.dataset.originalTheme`).catch(loading_result))break
      await pause(100)
    }
    assert.ok(frame,'每组主题必须完成真实预览加载')
    await js(`document.querySelector('iframe').contentWindow.focus()`)
    let state
    for(let attempt=0;attempt<20;attempt++) {
      state=await frame_js(frame, `({id:document.documentElement.dataset.originalTheme,mode:document.documentElement.dataset.originalMode,motion:document.querySelector('#codex-original-motion').dataset.motion,paused:document.querySelector('#codex-original-motion').dataset.paused,focus:document.hasFocus(),hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,home:!!document.querySelector('main.dream-skin-home-shell')})`)
      if(state.focus && state.paused===(state.motion==='none'||state.reduced?'true':'false'))break
      await pause(100)
    }
    console.log('预览运行状态：'+JSON.stringify(state))
    assert.equal(state.id,expected_ids[index],`第${index+1}张卡片必须加载预期主题`)
    assert.equal(state.mode,'dark')
    assert.equal(state.focus,true)
    assert.equal(state.paused,state.motion==='none'||state.reduced?'true':'false','聚焦预览应按主题能力和系统减少动态效果设置播放或暂停')
    previews.push(state)
    const upgraded = upgraded_ids.includes(expected_ids[index])
    const extended_tabs = await js(`['设置预览','组件状态预览'].map(label=>!!document.querySelector('[aria-label="'+label+'"]'))`)
    assert.deepEqual(extended_tabs, [upgraded, upgraded], `${expected_ids[index]} 的设置和组件状态标签可见性必须符合 ui_revision=1`)
    if (upgraded) for (const [view,label,part] of [['settings','设置预览','settings'],['components','组件状态预览','menu']]) {
      step(`${index+1}/${count} ${expected_ids[index]} ${view}`)
      const previous_extended_frames = frame_ids()
      await js(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`)
      let extended_frame, extended_state
      for(let attempt=0;attempt<60;attempt++) {
        extended_frame=loaded_preview(previous_extended_frames)
        extended_state=extended_frame ? await frame_js(extended_frame, `({id:document.documentElement.dataset.originalTheme,view:document.body.dataset.previewView,part:!!document.querySelector('[data-cm-theme-part~=${JSON.stringify(part)}]'),iframe_content:document.body.textContent.trim().length})`).catch(loading_result) : null
        if(extended_state?.id===expected_ids[index]&&extended_state.view===view)break
        await pause(100)
      }
      assert.ok(extended_frame && extended_state, `${expected_ids[index]} ${view} 必须完成真实 iframe 渲染`)
      assert.equal(extended_state.id, expected_ids[index])
      assert.equal(extended_state.view, view)
      assert.equal(extended_state.part, true, `${expected_ids[index]} ${view} 必须包含对应组件语义标记`)
      assert.ok(extended_state.iframe_content > 0, `${expected_ids[index]} ${view} iframe 不能为空`)
      extended_previews.push({id:expected_ids[index],view,...extended_state})
      console.log('扩展预览通过：'+JSON.stringify(extended_state))
      frame=extended_frame
    }
    step(`${index+1}/${count} ${expected_ids[index]} 关闭预览`)
    await js(`document.querySelector('iframe').contentWindow.focus()`)
    await window.webContents.sendInputEvent({ type:'keyDown',keyCode:'Escape' })
    await window.webContents.sendInputEvent({ type:'keyUp',keyCode:'Escape' })
    for(let attempt=0;attempt<20;attempt++) {
      if(!await js(`!!document.querySelector('.original-preview-modal')`))break
      await pause(50)
    }
    assert.equal(await js(`!!document.querySelector('.original-preview-modal')`),false)
  }
  assert.deepEqual(previews.map(state=>state.id),expected_ids,'图库预览必须完整覆盖20组主题并保持既定顺序')
  for (const theme of ['light','dark']) {
    nativeTheme.themeSource = theme
    await js(`document.querySelector('[aria-label="${theme==='light'?'浅色':'深色'}预览"]').click();for(let element=document.querySelector('.original-gallery');element;element=element.parentElement)element.scrollTop=0`)
    for (const [width,height] of [[920,650],[1280,800],[1920,1080]]) {
      step(`${theme} ${width}×${height} 截图`)
      window.setContentSize(width,height)
      await pause(300)
      assert.equal(await js(`document.documentElement.scrollWidth > innerWidth+1`), false, '页面不能横向溢出')
      await fs.writeFile(path.join(output, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
  }
  assert.deepEqual(errors, [])
  assert.equal(extended_previews.length, 40, '二十组升级主题必须各验证设置和组件状态两个 iframe')
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({count,scale,samples,packaged,source_labels,previews,extended_previews,errors,passed:true},null,2))
  console.log(JSON.stringify({passed:true,count,scale,output}))
  app.exit(0)
}
run().catch(async error => {
  console.error('主题馆界面验证失败：',error)
  if (result_path) await fs.writeFile(result_path,JSON.stringify({passed:false,scale,step:current_step,reason:error.message,stack:error.stack},null,2))
  app.exit(1)
})
