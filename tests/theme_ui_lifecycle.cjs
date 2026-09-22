// 在隔离 Electron 页面中验证完整界面主题适配器的资源生命周期和真实堆趋势。
const { app, BrowserWindow } = require('electron')
const Module = require('node:module')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const ids = JSON.parse(fs_sync.readFileSync(path.join(root, 'resources/skins/catalog.json'), 'utf8')).map(item => item.id)
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) || path.join(root, 'reports')
const json_path = path.join(output, '二十组完整界面生命周期验收-20260921.json')
const markdown_path = path.join(output, '二十组完整界面生命周期验收-20260921.md')
const sandbox = fs_sync.mkdtempSync(path.join(os.tmpdir(), 'theme-ui-lifecycle-'))
app.setPath('userData', sandbox)
app.commandLine.appendSwitch('disable-gpu')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const mib = bytes => Math.round(bytes / 1024 / 1024 * 1000) / 1000

const make_markdown = report => `# 二十组完整界面生命周期验收 - 20260921

## 结论

${report.passed ? '通过' : '未通过'}。本次仅使用隔离 Electron 合成页面，没有连接或重启真实 Codex。

## 运行证据

- 主题：${ids.join('、')}
- 连续切换：${report.cycles?.length ?? 0}/30 次
- 采样前预热：${report.warmup_count ?? 0} 个主题；排除首次编译与图片解码缓存的影响
- 动态节点：每轮新增、分类、移除并清理语义标记
- 挂载资源范围：Blob、活动 MutationObserver、待执行 requestAnimationFrame、timeout、interval、通过 EventTarget 注册的监听器、主题样式及动效节点
- 清理结果：\`${JSON.stringify(report.cleanup ?? {})}\`
- 控制台错误：${report.console_errors?.length ?? 0}
- 堆采样：通过 DevTools \`HeapProfiler.collectGarbage\` 后调用 \`Runtime.getHeapUsage\`；采样值是 V8 实际堆使用量，不等同于资源计数
- 堆基线：${report.heap?.baseline_mib ?? '无'} MiB；挂载样本末值：${report.heap?.mounted_last_mib ?? '无'} MiB；最终清理：${report.heap?.cleanup_mib ?? '无'} MiB
- 堆趋势边界：后半段挂载样本末值相对前半段最大值增长不超过 2 MiB；此阈值用于发现连续明显增长，不证明没有任何内存泄漏

## 原生偏好保留

初始页面用原生样式声明 body 为 Georgia、code 为 Consolas/19px。挂载期间改为 Verdana/23px，后续主题切换仍保留；移除临时偏好后恢复初始值。

## 验证边界

本测试验证合成 DOM 中由主题 payload 和组件适配器创建、且可被测试钩子观测的资源。MutationObserver 统计的是 observe 后尚未 disconnect 的实例；requestAnimationFrame、timeout 和 interval 统计的是尚未回收的句柄；监听器按 target/type/callback/capture 配对统计。V8 堆采样会受引擎缓存和垃圾回收策略影响，因此仅单独报告趋势，不把资源计数稳定解释为堆稳定，也不替代真实 Codex 实机验收。

${report.failure ? `## 未通过项\n\n\`${report.failure}\`\n` : ''}`

async function write_report(report) {
  await fs.mkdir(path.dirname(json_path), { recursive: true })
  await fs.writeFile(json_path, JSON.stringify(report, null, 2))
  await fs.writeFile(markdown_path, make_markdown(report))
}

async function run() {
  const report = {
    passed: false,
    generated_at: new Date().toISOString(),
    isolation: { user_data: sandbox, real_codex_connected: false, real_codex_restarted: false },
    ids,
    cycles: [],
    heap_samples: [],
    console_errors: [],
  }
  await write_report(report)

  const store = path.join(root, 'node_modules', '.pnpm')
  const esbuild_directory = fs_sync.readdirSync(store).find(name => name.startsWith('esbuild@'))
  assert.ok(esbuild_directory, '未找到项目 pnpm 安装的 esbuild')
  const { buildSync } = require(path.join(store, esbuild_directory, 'node_modules', 'esbuild'))
  const bundle = buildSync({
    entryPoints: [path.join(__dirname, 'theme_ui_lifecycle_entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  }).outputFiles[0].text
  const compiled = new Module(__filename, module)
  compiled.filename = __filename
  compiled.paths = module.paths
  compiled._compile(bundle, __filename)
  const { build_skin_payload } = compiled.exports

  await app.whenReady()
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  window.webContents.on('console-message', event => {
    if (event.level === 'error') report.console_errors.push(event.message)
  })
  const js = source => window.webContents.executeJavaScript(source, true)
  const wait_for = expression => js(`new Promise(resolve=>{let count=0;const check=()=>{if(${expression})resolve(true);else if(++count>=60)resolve(false);else requestAnimationFrame(check)};check()})`)
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><style>body{font-family:Georgia}code{font-family:Consolas;font-size:19px}</style></head><body><header role="banner">标题</header><aside class="app-shell-left-panel"><button>项目</button></aside><main class="main-surface" role="main"><div class="composer-surface-chrome"><div role="textbox" contenteditable="true">输入</div></div><code>const value=1</code><div id="dynamic-host"></div></main></body></html>`))

  await js(`(() => {
    const audit = window.__themeAudit = {blobs:new Set(),observers:new Set(),frames:new Set(),timeouts:new Set(),intervals:new Set(),listeners:[]};
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {const value=create(blob);audit.blobs.add(value);return value};
    URL.revokeObjectURL = value => {audit.blobs.delete(value);return revoke(value)};
    const NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      constructor(callback){super(callback);this.__auditActive=false}
      observe(...args){this.__auditActive=true;audit.observers.add(this);return super.observe(...args)}
      disconnect(){this.__auditActive=false;audit.observers.delete(this);return super.disconnect()}
    };
    const raf=window.requestAnimationFrame.bind(window), caf=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {let id;id=raf(time=>{audit.frames.delete(id);callback(time)});audit.frames.add(id);return id};
    window.cancelAnimationFrame = id => {audit.frames.delete(id);return caf(id)};
    const timeout=window.setTimeout.bind(window), clearTimeoutNative=window.clearTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {let id;id=timeout((...values)=>{audit.timeouts.delete(id);callback(...values)},delay,...args);audit.timeouts.add(id);return id};
    window.clearTimeout = id => {audit.timeouts.delete(id);return clearTimeoutNative(id)};
    const interval=window.setInterval.bind(window), clearIntervalNative=window.clearInterval.bind(window);
    window.setInterval = (...args) => {const id=interval(...args);audit.intervals.add(id);return id};
    window.clearInterval = id => {audit.intervals.delete(id);return clearIntervalNative(id)};
    const add=EventTarget.prototype.addEventListener, remove=EventTarget.prototype.removeEventListener;
    const capture = options => typeof options==='boolean' ? options : !!options?.capture;
    const trackedTarget = target => target===window || target===document || target instanceof MediaQueryList;
    EventTarget.prototype.addEventListener = function(type, callback, options){
      if(trackedTarget(this) && callback && !audit.listeners.some(item=>item.target===this&&item.type===type&&item.callback===callback&&item.capture===capture(options))) audit.listeners.push({target:this,type,callback,capture:capture(options)});
      return add.call(this,type,callback,options);
    };
    EventTarget.prototype.removeEventListener = function(type, callback, options){
      const flag=capture(options);audit.listeners=audit.listeners.filter(item=>!(item.target===this&&item.type===type&&item.callback===callback&&item.capture===flag));
      return remove.call(this,type,callback,options);
    };
  })()`)

  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Runtime.enable')
  await window.webContents.debugger.sendCommand('HeapProfiler.enable')
  const heap_sample = async label => {
    await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
    const usage = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage')
    const sample = { label, used_size: usage.usedSize, used_mib: mib(usage.usedSize), total_size: usage.totalSize, total_mib: mib(usage.totalSize) }
    report.heap_samples.push(sample)
    return sample
  }
  const metrics = () => js(`(() => {const a=window.__themeAudit;return {blobs:a.blobs.size,observers:[...a.observers].filter(x=>x.__auditActive).length,frames:a.frames.size,timeouts:a.timeouts.size,intervals:a.intervals.size,listeners:a.listeners.length,styles:document.querySelectorAll('#codex-original-theme-style').length,motion:document.querySelectorAll('#codex-original-motion').length,parts_state:!!window.__CODEX_MANAGER_THEME_PARTS_STATE__,part_nodes:document.querySelectorAll('[data-cm-theme-part]').length,body_font:getComputedStyle(document.body).fontFamily,code_font:getComputedStyle(document.querySelector('code')).fontFamily,code_size:getComputedStyle(document.querySelector('code')).fontSize}})()`)

  // 先覆盖全部主题的首次编译和解码，后续只比较相同主题集合的稳定切换。
  for (const id of ids) await js(await build_skin_payload(id, false, path.join(root, 'resources', 'skins'), path.join(root, 'resources', 'theme-engine')))
  await js('window.__CODEX_DREAM_SKIN_STATE__.cleanup()')
  await pause(40)
  report.warmup_count = ids.length
  const baseline_heap = await heap_sample('baseline')
  let mounted_signature
  for (let index = 0; index < 30; index += 1) {
    const id = ids[index % ids.length]
    await js(await build_skin_payload(id, index % 2 === 0, path.join(root, 'resources', 'skins'), path.join(root, 'resources', 'theme-engine')))
    await js(`(() => {const node=document.createElement('div');node.id='dynamic-node';node.innerHTML='<div role="dialog"><button role="menuitem">动态菜单</button></div>';document.querySelector('#dynamic-host').appendChild(node)})()`)
    await wait_for(`document.querySelector('#dynamic-node [role="dialog"]')?.getAttribute('data-cm-theme-part')?.split(/\\s+/).includes('dialog')`)
    const dynamic = await js(`({dialog:document.querySelector('#dynamic-node [role="dialog"]')?.getAttribute('data-cm-theme-part'),button:document.querySelector('#dynamic-node button')?.getAttribute('data-cm-theme-part')})`)
    assert.ok(dynamic.dialog?.split(/\s+/).includes('dialog'), `${id} 动态对话框未被适配器分类`)
    assert.ok(dynamic.button?.split(/\s+/).includes('menu-item'), `${id} 动态菜单项未被适配器分类`)
    await js(`window.__removedDynamic=document.querySelector('#dynamic-node');window.__removedDynamic.remove()`)
    const removed_cleaned = await wait_for(`!window.__removedDynamic.querySelector('[data-cm-theme-part]')`)
    const removed_state = await js(`({html:window.__removedDynamic.outerHTML,frames:window.__themeAudit.frames.size,document_parts:document.querySelectorAll('[data-cm-theme-part]').length})`)
    assert.equal(removed_cleaned, true, `${id} 已移除动态节点未在60帧内清理适配器标记：${JSON.stringify(removed_state)}`)

    if (index === 14) await js(`document.body.style.fontFamily='Verdana';document.querySelector('code').style.fontSize='23px'`)
    const current = await metrics()
    assert.ok(current.blobs >= 2 && current.blobs <= 3, `${id} Blob 数量超出主题引擎边界`)
    assert.equal(current.observers, 3, `${id} 应只有基础注入器、原生扩展与组件适配器三个活动 MutationObserver`)
    assert.equal(current.frames, 0, `${id} 适配器帧任务未收敛`)
    assert.equal(current.timeouts, 1, `${id} 应只有基础注入器的一个去抖 timeout`)
    assert.equal(current.intervals, 1, `${id} 应只有基础注入器的一个自修复 interval`)
    assert.equal(current.styles, 1, `${id} 主题样式节点数量异常`)
    assert.equal(current.motion, 1, `${id} 动效节点数量异常`)
    assert.equal(current.parts_state, true, `${id} 组件适配器状态缺失`)
    const signature = JSON.stringify({blobs:current.blobs,observers:current.observers,frames:current.frames,timeouts:current.timeouts,intervals:current.intervals,listeners:current.listeners,styles:current.styles,motion:current.motion})
    if (mounted_signature === undefined) mounted_signature = signature
    assert.equal(signature, mounted_signature, `${id} 第 ${index + 1} 次切换后资源挂载数量发生增长`)
    if (index < 14) {
      assert.equal(current.body_font, 'Georgia')
      assert.ok(current.code_font.includes('Consolas'))
      assert.equal(current.code_size, '19px')
    } else {
      assert.equal(current.body_font, 'Verdana', '挂载期间修改的 body 字体偏好未保留')
      assert.equal(current.code_size, '23px', '挂载期间修改的 code 字号偏好未保留')
    }
    report.cycles.push({index:index + 1,id,metrics:current,dynamic})
    if ((index + 1) % 5 === 0) await heap_sample(`mounted-${index + 1}`)
  }

  await js(`document.body.style.removeProperty('font-family');document.querySelector('code').style.removeProperty('font-size');window.__CODEX_DREAM_SKIN_STATE__.cleanup()`)
  await pause(40)
  report.cleanup = await metrics()
  assert.deepEqual(report.cleanup, {blobs:0,observers:0,frames:0,timeouts:0,intervals:0,listeners:0,styles:0,motion:0,parts_state:false,part_nodes:0,body_font:'Georgia',code_font:'Consolas',code_size:'19px'})
  const cleanup_heap = await heap_sample('cleanup')
  const mounted = report.heap_samples.filter(sample => sample.label.startsWith('mounted-'))
  const first_half_max = Math.max(...mounted.slice(0, 3).map(sample => sample.used_size))
  const mounted_growth = mounted.at(-1).used_size - first_half_max
  report.heap = {
    baseline_mib: baseline_heap.used_mib,
    mounted_last_mib: mounted.at(-1).used_mib,
    cleanup_mib: cleanup_heap.used_mib,
    mounted_growth_from_first_half_max_mib: mib(mounted_growth),
    threshold_mib: 2,
  }
  await write_report(report)
  assert.ok(mounted_growth <= 2 * 1024 * 1024, `强制回收后的挂载堆末值相对前半段最大值增长 ${mib(mounted_growth)} MiB，超过 2 MiB 边界`)
  assert.deepEqual(report.console_errors, [])
  report.passed = true
  await write_report(report)
  console.log(JSON.stringify({passed:true,cycles:report.cycles.length,cleanup:report.cleanup,heap:report.heap,json:json_path,markdown:markdown_path}))
  window.webContents.debugger.detach()
  window.destroy()
  await fs.rm(sandbox, { recursive: true, force: true })
  app.exit(0)
}

run().catch(async error => {
  const failure = error?.stack || String(error)
  try {
    const previous = JSON.parse(await fs.readFile(json_path, 'utf8'))
    previous.passed = false
    previous.failure = failure
    await write_report(previous)
  } catch {}
  console.error('完整界面样板生命周期验收失败：', failure)
  app.exit(1)
})
