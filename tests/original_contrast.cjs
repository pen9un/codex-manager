// 在隔离 Electron 中按真实叠加背景验证主题馆文字对比度，不连接用户客户端。
const { app, BrowserWindow, nativeImage } = require('electron')
const Module = require('node:module')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const project_root = path.resolve(__dirname, '..')
const package_store = path.join(project_root, 'node_modules/.pnpm')
const esbuild_package = fs_sync.readdirSync(package_store).find(name => name.startsWith('esbuild@'))
if (!esbuild_package) throw new Error('缺少文字对比度验收所需的 esbuild')
const { buildSync } = require(path.join(package_store, esbuild_package, 'node_modules/esbuild'))
const bundled = buildSync({
  entryPoints: [path.join(__dirname, 'theme_preview_electron_entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text
const compiled = new Module(__filename, module)
compiled.filename = __filename
compiled.paths = module.paths
compiled._compile(bundled, __filename)
const { render_skin_preview } = compiled.exports

const viewport = { width: 1280, height: 800 }
const sample_mode = process.argv.includes('--samples')
const report_path = path.join(project_root, 'reports', sample_mode ? 'theme-ui-samples-20260921/contrast.json' : 'theme-v2-final-contrast-20260920.json')
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const user_data_directory = fs_sync.mkdtempSync(path.join(os.tmpdir(), 'original-contrast-profile-'))
app.setPath('userData', user_data_directory)
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => undefined)
const clear_user_data = () => { try { fs_sync.rmSync(user_data_directory, {recursive:true,force:true}) } catch {} }
app.on('will-quit', clear_user_data)
app.on('quit', clear_user_data)

const collect_text_expression = `(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  const rgba = value => {
    context.clearRect(0,0,1,1);
    context.fillStyle = '#000';
    context.fillStyle = value;
    context.fillRect(0,0,1,1);
    return Array.from(context.getImageData(0,0,1,1).data);
  };
  const describe = element => {
    const classes = [...element.classList].slice(0,3).map(value => '.' + value).join('');
    const label = element.getAttribute('aria-label');
    return element.tagName.toLowerCase() + classes + (label ? '[aria-label="' + label.slice(0,60) + '"]' : '');
  };
  const clip = (input, element) => {
    const value = {left:Math.max(0,input.left),top:Math.max(0,input.top),right:Math.min(innerWidth,input.right),bottom:Math.min(innerHeight,input.bottom)};
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      const style = getComputedStyle(current);
      const bounds = current.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { value.left=Math.max(value.left,bounds.left); value.right=Math.min(value.right,bounds.right); }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { value.top=Math.max(value.top,bounds.top); value.bottom=Math.min(value.bottom,bounds.bottom); }
    }
    return value.right > value.left && value.bottom > value.top ? value : null;
  };
  const opacity = element => {
    let value = 1;
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) value *= Number.parseFloat(getComputedStyle(current).opacity || '1');
    return value;
  };
  const records = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || '').replace(/\\s+/g,' ').trim();
    const element = node.parentElement;
    if (!text || !element || /^(script|style|noscript|template)$/i.test(element.tagName)) continue;
    if (element.closest('[hidden],[aria-hidden="true"],:disabled,[aria-disabled="true"]')) continue;
    const style = getComputedStyle(element);
    const effective_opacity = opacity(element);
    if (style.display === 'none' || style.visibility !== 'visible' || effective_opacity <= 0.001 || Number.parseFloat(style.fontSize) <= 0) continue;
    if (element.checkVisibility && !element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
    const color = rgba(style.color);
    if (color[3] <= 1) continue;
    const heading = !!element.closest('h1,h2,h3,h4,h5,h6,[role="heading"]');
    const font_size = Number.parseFloat(style.fontSize);
    const numeric_weight = Number.parseInt(style.fontWeight,10);
    const font_weight = Number.isFinite(numeric_weight) ? numeric_weight : (/bold/i.test(style.fontWeight) ? 700 : 400);
    const large = font_size >= 24 || font_size >= 18.66 && font_weight >= 700;
    const clarity_body = !heading && !!element.closest('main') && !!element.closest('article,p,pre,code,[data-message-author-role],.ProseMirror,.thread-scroll-container') && !element.closest('button,[role="button"],nav,header');
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rectangle of range.getClientRects()) {
      const visible = clip(rectangle, element);
      if (!visible || visible.right-visible.left < 0.5 || visible.bottom-visible.top < 0.5) continue;
      records.push({
        text:text.slice(0,120), element:describe(element), kind:heading?'heading':'normal', large, clarity_body,
        font_size, font_weight, color, opacity:effective_opacity,
        rect:{x:visible.left,y:visible.top,width:visible.right-visible.left,height:visible.bottom-visible.top},
      });
    }
  }
  return records;
})()`

const mask_text_expression = `(() => {
  document.documentElement.dataset.contrastAudit = '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.nodeValue || '').trim() && node.parentElement && !/^(script|style|noscript|template)$/i.test(node.parentElement.tagName)) nodes.push(node);
  }
  for (const node of nodes) {
    const mask = document.createElement('span');
    mask.dataset.contrastMask = '';
    node.parentNode.replaceChild(mask, node);
    mask.appendChild(node);
  }
  return nodes.length;
})()`

function bitmap_channels() {
  const calibration = nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADklEQVR4nGP4z8DAAMYADvsC/gkcFjQAAAAASUVORK5CYII=', 'base64')).toBitmap({scaleFactor:1})
  const colors = [calibration.subarray(0,4), calibration.subarray(4,8), calibration.subarray(8,12)].map(value => [...value])
  const channel = color => color.slice(0, 3).indexOf(Math.max(...color.slice(0, 3)))
  const red = channel(colors[0]), green = channel(colors[1]), blue = channel(colors[2])
  if (new Set([red, green, blue]).size !== 3) throw new Error(`无法识别 NativeImage 位图通道：${JSON.stringify(colors)}`)
  return { red, green, blue, alpha: 6 - red - green - blue }
}

const linear = value => {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}
const luminance = color => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
const contrast = (foreground, background) => {
  const foreground_luminance = luminance(foreground), background_luminance = luminance(background)
  return (Math.max(foreground_luminance, background_luminance) + 0.05) / (Math.min(foreground_luminance, background_luminance) + 0.05)
}

function inspect_record(record, bitmap, width, height, channels, clarity) {
  const left = Math.max(0, Math.floor(record.rect.x))
  const top = Math.max(0, Math.floor(record.rect.y))
  const right = Math.min(width, Math.ceil(record.rect.x + record.rect.width))
  const bottom = Math.min(height, Math.ceil(record.rect.y + record.rect.height))
  const foreground_alpha = record.color[3] / 255 * record.opacity
  let worst = { contrast: Number.POSITIVE_INFINITY, background: null, pixel: null }
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const offset = (y * width + x) * 4
    const background = { r: bitmap[offset + channels.red], g: bitmap[offset + channels.green], b: bitmap[offset + channels.blue] }
    const foreground = {
      r: record.color[0] * foreground_alpha + background.r * (1 - foreground_alpha),
      g: record.color[1] * foreground_alpha + background.g * (1 - foreground_alpha),
      b: record.color[2] * foreground_alpha + background.b * (1 - foreground_alpha),
    }
    const value = contrast(foreground, background)
    if (value < worst.contrast) worst = { contrast:value, background, pixel:{x,y} }
  }
  const threshold = clarity && record.clarity_body ? 7 : record.large ? 3 : 4.5
  return {
    ...record,
    threshold,
    contrast: Number(worst.contrast.toFixed(3)),
    foreground: { r:record.color[0], g:record.color[1], b:record.color[2], a:Number(foreground_alpha.toFixed(3)) },
    background: worst.background,
    pixel: worst.pixel,
    passed: worst.contrast >= threshold,
  }
}

async function capture_page(window, label) {
  let last_size = {width:0,height:0}
  for (let attempt = 0; attempt < 4; attempt++) {
    window.webContents.invalidate()
    if (attempt) await pause(500)
    const image = await window.webContents.capturePage()
    last_size = image.getSize(1)
    if (last_size.width === viewport.width && last_size.height === viewport.height) return image
  }
  throw new Error(`${label} 连续四次截图尺寸异常：${last_size.width}x${last_size.height}`)
}

async function audit_page(window, entry, mode, view, skins_root, preview_file) {
  const html = await render_skin_preview(entry.id, mode, view, false, skins_root)
  await fs.writeFile(preview_file, html)
  await window.loadFile(preview_file)
  window.setContentSize(viewport.width, viewport.height)
  await pause(450)
  const records = await window.webContents.executeJavaScript(collect_text_expression, true)
  assert.ok(records.some(record => record.kind === 'heading'), `${entry.id}/${mode}/${view} 未收集到 heading`)
  assert.ok(records.some(record => record.kind === 'normal'), `${entry.id}/${mode}/${view} 未收集到 normal`)
  await window.webContents.executeJavaScript(mask_text_expression, true)
  const css_key = await window.webContents.insertCSS(`html[data-contrast-audit] *{text-overflow:clip!important}html[data-contrast-audit][data-contrast-audit][data-contrast-audit][data-contrast-audit][data-contrast-audit][data-contrast-audit] [data-contrast-mask]{display:contents!important;visibility:hidden!important;color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;caret-color:transparent!important}`)
  window.webContents.invalidate()
  await pause(120)
  const visible_masks = await window.webContents.executeJavaScript(`[...document.querySelectorAll('[data-contrast-mask]')].filter(element=>{const style=getComputedStyle(element);return style.visibility!=='hidden'||style.color!=='rgba(0, 0, 0, 0)'}).length`)
  assert.equal(visible_masks, 0, `${entry.id}/${mode}/${view} 文字遮罩未生效`)
  await capture_page(window, `${entry.id}/${mode}/${view} 预热`)
  await pause(50)
  const image = await capture_page(window, `${entry.id}/${mode}/${view}`)
  await window.webContents.removeInsertedCSS(css_key)
  const size = image.getSize(1)
  const bitmap = image.toBitmap({ scaleFactor: 1 })
  const channels = bitmap_channels()
  const results = records.map(record => inspect_record(record, bitmap, size.width, size.height, channels, entry.id === 'clarity'))
  const failures = results.filter(result => !result.passed)
  const worst = values => [...values].sort((a,b) => a.contrast-b.contrast)[0] || null
  return {
    id: entry.id, mode, view, rectangles:results.length,
    heading_rectangles:results.filter(result => result.kind === 'heading').length,
    normal_rectangles:results.filter(result => result.kind === 'normal').length,
    clarity_body_rectangles:results.filter(result => result.clarity_body).length,
    worst:{heading:worst(results.filter(result => result.kind === 'heading')),normal:worst(results.filter(result => result.kind === 'normal')),clarity_body:worst(results.filter(result => result.clarity_body))}, failures,
  }
}

async function run() {
  const skins_root = path.join(project_root, 'resources/skins')
  let catalog = JSON.parse(await fs.readFile(path.join(skins_root, 'catalog.json'), 'utf8'))
  assert.equal(catalog.length, 20, '最终目录应有 20 组主题')
  if (sample_mode) catalog = catalog.filter(entry => ['fruit-base','lulu-duo','totoro-stop','zero-day'].includes(entry.id))
  const views = sample_mode ? ['home','task','settings','components'] : ['home','task']
  await fs.mkdir(path.dirname(report_path), { recursive:true })
  await app.whenReady()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'original-contrast-'))
  const preview_file = path.join(temporary, 'preview.html')
  const window = new BrowserWindow({
    width:viewport.width, height:viewport.height, useContentSize:true, show:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true},
  })
  const console_errors = []
  window.webContents.on('render-process-gone', (_event, details) => { console_errors.push(`对比度验收渲染进程退出：${details.reason}`) })
  window.webContents.on('console-message', event => { if (event.level === 'error') console_errors.push(event.message) })
  const scenarios = []
  try {
    for (const entry of catalog) for (const mode of ['light','dark']) for (const view of views) {
      console.log(`开始检查：${entry.id} ${mode} ${view}`)
      let timeout
      const result = await Promise.race([
        audit_page(window, entry, mode, view, skins_root, preview_file),
        new Promise((_,reject) => { timeout=setTimeout(()=>reject(new Error(`${entry.id}/${mode}/${view} 对比度验收超过30秒`)),30000) }),
      ]).finally(()=>clearTimeout(timeout))
      scenarios.push(result)
      console.log(`已检查：${entry.id} ${mode} ${view}，最差 ${Math.min(result.worst.heading?.contrast ?? 99,result.worst.normal?.contrast ?? 99).toFixed(3)}，失败 ${result.failures.length}`)
    }
  } finally {
    window.destroy()
    await fs.rm(temporary, {recursive:true,force:true})
  }
  const failures = scenarios.flatMap(scenario => scenario.failures.map(failure => ({id:scenario.id,mode:scenario.mode,view:scenario.view,...failure})))
  const measured_worst = [...scenarios.flatMap(scenario => [scenario.worst.heading,scenario.worst.normal]).filter(Boolean)].sort((a,b) => a.contrast-b.contrast)[0]
  const clarity_worst = [...scenarios.filter(scenario => scenario.id === 'clarity').map(scenario => scenario.worst.clarity_body).filter(Boolean)].sort((a,b) => a.contrast-b.contrast)[0]
  const report = {
    passed: failures.length === 0 && console_errors.length === 0,
    generated_at: new Date().toISOString(), viewport,
    coverage:{themes:catalog.length,ids:catalog.map(entry=>entry.id),theme_modes:catalog.length*2,pages:scenarios.length,views,menus_and_dialogs:sample_mode,limitation:sample_mode?'隔离示例；包含菜单与弹窗。禁用控件按WCAG非活动控件例外排除，输入值及非文字边界另行检查。':'当前隔离 fixture 不包含菜单与弹窗，因此本报告不覆盖其文字。'},
    thresholds:{normal:4.5,large_text:3,method:'WCAG 相对亮度；最终目录不包含已移除的 clarity 主题。'},
    summary:{rectangles:scenarios.reduce((sum,item)=>sum+item.rectangles,0),failures:failures.length,console_errors:console_errors.length,worst_contrast:measured_worst?.contrast ?? null,clarity_body_worst_contrast:clarity_worst?.contrast ?? null},
    failures, scenarios, console_errors,
  }
  await fs.writeFile(report_path, JSON.stringify(report,null,2))
  console.log(JSON.stringify({passed:report.passed,pages:scenarios.length,rectangles:report.summary.rectangles,failures:failures.length,report:report_path}))
  app.exit(report.passed ? 0 : 1)
}

run().catch(async error => {
  console.error('主题馆第二版文字对比度验收失败：', error)
  await fs.mkdir(path.dirname(report_path), {recursive:true}).catch(()=>undefined)
  await fs.writeFile(report_path, JSON.stringify({passed:false,infrastructure_error:error instanceof Error?error.message:String(error)},null,2)).catch(()=>undefined)
  app.exit(1)
})
