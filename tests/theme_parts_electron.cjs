// 在隔离 Electron 页面中验证语义区域标记，不连接或修改真实 Codex 客户端。
const { app, BrowserWindow, protocol } = require('electron')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-theme-parts-'))
app.setPath('userData', sandbox)
protocol.registerSchemesAsPrivileged([{ scheme: 'cmtest', privileges: { standard: true, secure: true } }])

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run() {
  const store = path.join(root, 'node_modules/.pnpm')
  const esbuild_directory = fs.readdirSync(store).find(name => name.startsWith('esbuild@'))
  assert.ok(esbuild_directory, '未找到项目 pnpm 安装的 esbuild')
  const { buildSync } = require(path.join(store, esbuild_directory, 'node_modules/esbuild'))
  const bundle = buildSync({
    entryPoints: [path.join(__dirname, 'theme_parts_electron_entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  }).outputFiles[0].text
  const compiled = new Module(__filename, module)
  compiled.filename = __filename
  compiled.paths = module.paths
  compiled._compile(bundle, __filename)
  const { install_theme_parts } = compiled.exports

  await app.whenReady()
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
  const fixture = `<!doctype html><html><body>
    <div class="titlebar"><div id="host-header" role="banner" data-cm-theme-part="host-token"><h1>Codex</h1><button id="window-control">关闭</button></div></div>
    <div id="host-owned" role="banner" data-cm-theme-part="header host-token-2">宿主同名 token</div>
    <nav id="breadcrumb" aria-label="会话路径">会话 / 当前任务</nav>
    <button id="floating-composer" class="composer-surface-chrome" data-testid="floating-composer-reveal-handle">展开</button>
    <div id="popcorn-table" data-testid="popcorn-table-grid">表格</div>
    <div id="header-spacer" data-testid="right-panel-tab-bar-header-spacer">占位</div>
    <div id="context-surface" data-testid="app-shell-header-context-menu-surface">普通上下文容器</div>
    <header id="content-header">用户内容标题</header><div id="content-panel" class="content-panel">用户内容面板</div>
    <div id="host-whitespace" role="banner" data-cm-theme-part="  header   host-token-3  ">保留原始空白</div>
    <div id="host-empty" role="banner" data-cm-theme-part="">保留空属性</div>
    <div id="actual-titlebar" data-app-shell-header-layout="custom-titlebar" data-pip-obstacle="app-shell-header">真实标题栏结构</div>
    <aside class="app-shell-left-panel" data-testid="app-shell-floating-left-panel"><nav aria-label="项目"><button id="sidebar-button">新任务</button><ul data-app-action-sidebar-project-list-id="project-1"><li data-app-action-sidebar-project-row>项目一</li><li id="thread-row" data-app-action-sidebar-thread-row>会话一</li></ul></nav></aside>
    <div id="generic-conversation" class="conversation">普通内容容器</div>
    <button id="settings-label-button" aria-label="Settings">设置按钮</button>
    <main role="main"><section data-testid="chatgpt-work-home-page"></section>
      <section id="settings-controls"><input id="settings-input"><button id="settings-button">保存设置</button><div id="settings-tab" role="tab">常规</div></section>
      <article data-message-author-role="assistant"><button id="message-action">示例按钮文本</button><pre><code>const answer = 1</code></pre><pre class="diff">+1</pre></article>
      <div class="thread-scroll-container"></div>
      <div class="composer-surface-chrome"><div class="ProseMirror" contenteditable="true"></div><div data-composer-footer-responsive></div></div>
    </main>
    <section id="right-panel" role="tabpanel" data-app-shell-tab-panel-controller="right" data-tab-id="review"><button id="right-button">右栏操作</button></section>
    <section id="bottom-panel" role="tabpanel" data-app-shell-tab-panel-controller="bottom" data-tab-id="terminal">底栏</section>
    <section role="dialog"><input><button>确定</button><div role="tab">常规</div></section>
    <div role="tooltip">提示</div><div role="menu"><button role="menuitem">操作</button></div>
    <div class="terminal">PS&gt;</div>
  </body></html>`
  protocol.handle('cmtest', () => new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  await window.loadURL('cmtest://codex/settings/general')

  const source = `(${install_theme_parts.toString()})()`
  await window.webContents.executeJavaScript(`window.partsState=${source}; true`)
  await pause(40)
  const initial = await window.webContents.executeJavaScript(`({
    root: document.documentElement.getAttribute('data-cm-theme-part'),
    header: document.querySelector('#host-header').getAttribute('data-cm-theme-part'),
    main: document.querySelector('main').getAttribute('data-cm-theme-part'),
    composer: document.querySelector('.composer-surface-chrome:not(button)').getAttribute('data-cm-theme-part'),
    toolbar: document.querySelector('[data-composer-footer-responsive]').getAttribute('data-cm-theme-part'),
    message: document.querySelector('article').getAttribute('data-cm-theme-part'),
    menu: document.querySelector('[role=menu]').getAttribute('data-cm-theme-part'),
    menu_item: document.querySelector('[role=menuitem]').getAttribute('data-cm-theme-part'),
    dialog: document.querySelector('[role=dialog]').getAttribute('data-cm-theme-part'),
    code: document.querySelector('code').getAttribute('data-cm-theme-part'),
    diff: document.querySelector('.diff').getAttribute('data-cm-theme-part'),
    terminal: document.querySelector('.terminal').getAttribute('data-cm-theme-part')
  })`)
  assert.equal(initial.root, 'root')
  assert.equal(initial.header, 'host-token header')
  assert.match(initial.main, /(^| )main( |$)/)
  assert.equal(initial.composer, 'composer')
  assert.equal(initial.toolbar, 'composer-toolbar')
  assert.equal(initial.message, 'message')
  assert.equal(initial.menu, 'menu')
  assert.equal(initial.menu_item, 'menu-item button')
  assert.equal(initial.dialog, 'panel dialog')
  assert.equal(initial.code, 'code')
  assert.equal(initial.diff, 'code diff')
  assert.equal(initial.terminal, 'terminal')
  assert.match(initial.main, /(^| )settings( |$)/)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#settings-input').getAttribute('data-cm-theme-part')`), 'input')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#settings-button').getAttribute('data-cm-theme-part')`), 'button')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#settings-tab').getAttribute('data-cm-theme-part')`), 'tab')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#right-panel').getAttribute('data-cm-theme-part')`), 'right-panel panel')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#right-button').getAttribute('data-cm-theme-part')`), 'button')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#bottom-panel').hasAttribute('data-cm-theme-part')`), false)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#window-control').hasAttribute('data-cm-theme-part')`), false)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#message-action').hasAttribute('data-cm-theme-part')`), false)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-owned').getAttribute('data-cm-theme-part')`), 'header host-token-2')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#actual-titlebar').getAttribute('data-cm-theme-part')`), 'titlebar header')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#thread-row').getAttribute('data-cm-theme-part')`), 'conversation')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-app-action-sidebar-project-row]').getAttribute('data-cm-theme-part')`), 'project-list')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#sidebar-button').getAttribute('data-cm-theme-part')`), 'button')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#generic-conversation').hasAttribute('data-cm-theme-part')`), false)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#settings-label-button').hasAttribute('data-cm-theme-part')`), false)
  for (const id of ['breadcrumb', 'floating-composer', 'popcorn-table', 'header-spacer', 'context-surface', 'content-header', 'content-panel']) {
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#${id}').hasAttribute('data-cm-theme-part')`), false, `${id} 不应被宽泛选择器误标`)
  }

  // 稳定 DOM 上刷新不得重复写相同属性。
  const redundant_writes = await window.webContents.executeJavaScript(`new Promise(resolve => {
    let count=0;
    const observer=new MutationObserver(records => {count+=records.filter(record => record.attributeName==='data-cm-theme-part').length});
    observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-cm-theme-part']});
    window.partsState.refresh();
    requestAnimationFrame(() => {observer.disconnect(); resolve(count)});
  })`)
  assert.equal(redundant_writes, 0)

  // Radix portal 在挂载后补属性时也必须触发重新分类。
  await window.webContents.executeJavaScript(`const r=document.createElement('div'); r.id='radix-menu'; document.body.append(r)`)
  await pause(30)
  await window.webContents.executeJavaScript(`document.querySelector('#radix-menu').setAttribute('data-radix-menu-content','')`)
  await pause(150)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#radix-menu').getAttribute('data-cm-theme-part')`), 'menu')
  await window.webContents.executeJavaScript(`document.querySelector('#radix-menu').removeAttribute('data-radix-menu-content')`)
  await pause(150)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#radix-menu').hasAttribute('data-cm-theme-part')`), false)

  // composer 的半径属性后加时必须触发分类；展开把手即便复用表面类也不能成为 composer。
  await window.webContents.executeJavaScript(`const c=document.createElement('div'); c.id='late-composer'; c.setAttribute('data-composer-surface-variant','default'); document.body.append(c)`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#late-composer').hasAttribute('data-cm-theme-part')`), false)
  await window.webContents.executeJavaScript(`document.querySelector('#late-composer').setAttribute('data-composer-radius-variant','rounded')`)
  await pause(100)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#late-composer').getAttribute('data-cm-theme-part')`), 'composer')

  // 重复安装必须先清理旧实例，并保持宿主 token 不重复。
  await window.webContents.executeJavaScript(`window.partsState2=${source}; true`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-header').getAttribute('data-cm-theme-part')`), 'host-token header')

  // 模式与路由变化后重新分类；动态 portal 与列表项也应覆盖。
  await window.webContents.executeJavaScript(`
    document.documentElement.dataset.theme='light';
    document.querySelector('[data-testid="chatgpt-work-home-page"]').remove();
    const portal=document.createElement('div'); portal.role='menu'; portal.innerHTML='<button role="menuitem">新菜单</button>'; document.body.append(portal);
    const item=document.createElement('li'); item.textContent='项目二'; item.setAttribute('data-app-action-sidebar-project-row',''); document.querySelector('[data-app-action-sidebar-project-list-id]').append(item);
  `)
  await pause(60)
  const changed = await window.webContents.executeJavaScript(`({
    main: document.querySelector('main').getAttribute('data-cm-theme-part'),
    portal: [...document.querySelectorAll('[role=menu]')].at(-1).getAttribute('data-cm-theme-part'),
    item: [...document.querySelectorAll('[data-app-action-sidebar-project-row]')].at(-1).getAttribute('data-cm-theme-part')
  })`)
  assert.doesNotMatch(changed.main, /(^| )home( |$)/)
  assert.equal(changed.portal, 'menu')
  assert.equal(changed.item, 'project-list')

  // 移出匹配范围的节点必须解除本安装器标记，保留宿主值。
  await window.webContents.executeJavaScript(`document.querySelector('#host-header').removeAttribute('role')`)
  await pause(60)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-header').getAttribute('data-cm-theme-part')`), 'host-token')

  // 与适配 token 同名的宿主值在失配、重新进入和清理时必须始终保留。
  await window.webContents.executeJavaScript(`document.querySelector('#host-owned').removeAttribute('role')`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-owned').getAttribute('data-cm-theme-part')`), 'header host-token-2')
  await window.webContents.executeJavaScript(`document.querySelector('#host-owned').setAttribute('role','banner')`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-owned').getAttribute('data-cm-theme-part')`), 'header host-token-2')
  await window.webContents.executeJavaScript(`window.detachedOwned=document.querySelector('#host-owned'); window.detachedOwned.remove()`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`window.detachedOwned.getAttribute('data-cm-theme-part')`), 'header host-token-2')
  // 完全移除的节点恢复后必须退出 tracked；cleanup 不得继续持有并覆盖离线节点。
  await window.webContents.executeJavaScript(`window.removedNodes=Array.from({length:100},(_,index)=>{const n=document.createElement('div'); n.setAttribute('role','banner'); n.setAttribute('data-cm-theme-part','host-'+index); document.body.append(n); return n})`)
  await pause(100)
  await window.webContents.executeJavaScript(`window.removedNodes.forEach(node=>node.remove())`)
  await pause(100)
  assert.equal(await window.webContents.executeJavaScript(`window.removedNodes.every((node,index)=>node.getAttribute('data-cm-theme-part')==='host-'+index)`), true)
  await window.webContents.executeJavaScript(`window.removedNodes.forEach(node=>node.setAttribute('data-cm-theme-part','offline-change'))`)
  await window.webContents.executeJavaScript(`document.querySelector('#host-whitespace').removeAttribute('role'); document.querySelector('#host-empty').removeAttribute('role')`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-whitespace').getAttribute('data-cm-theme-part')`), '  header   host-token-3  ')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-empty').getAttribute('data-cm-theme-part')`), '')
  await window.webContents.executeJavaScript(`document.body.append(window.detachedOwned)`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`window.detachedOwned.getAttribute('data-cm-theme-part')`), 'header host-token-2')

  // 预览映射仅在 body 有预览模式标志时生效。
  await window.webContents.executeJavaScript(`const p=document.createElement('div'); p.dataset.cmPreviewPart='tab button settings invalid'; p.id='preview'; document.body.append(p)`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#preview').hasAttribute('data-cm-theme-part')`), false)
  await window.webContents.executeJavaScript(`document.body.dataset.previewView='theme'`)
  await pause(40)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#preview').getAttribute('data-cm-theme-part')`), 'tab button settings')

  // 清理恢复原属性、取消后续回调，清理后新增节点不得重新注入。
  await window.webContents.executeJavaScript(`window.partsState2.cleanup()`)
  await pause(40)
  const cleaned = await window.webContents.executeJavaScript(`({count:document.querySelectorAll('[data-cm-theme-part]').length,header:document.querySelector('#host-header').getAttribute('data-cm-theme-part')})`)
  assert.equal(cleaned.count, 4)
  assert.equal(cleaned.header, 'host-token')
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#host-owned').getAttribute('data-cm-theme-part')`), 'header host-token-2')
  assert.equal(await window.webContents.executeJavaScript(`window.removedNodes.every(node=>node.getAttribute('data-cm-theme-part')==='offline-change')`), true)
  await window.webContents.executeJavaScript(`const late=document.createElement('div'); late.role='tooltip'; late.id='late'; document.body.append(late)`)
  await pause(50)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#late').hasAttribute('data-cm-theme-part')`), false)
  await window.webContents.executeJavaScript(`window.raceState=${source}; const race=document.createElement('div'); race.role='tooltip'; race.id='race'; document.body.append(race); window.raceState.cleanup(); true`)
  await pause(50)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#race').hasAttribute('data-cm-theme-part')`), false)

  // 未知路由即便存在 main，也不得获得 settings 标记。
  const unknown_window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
  await unknown_window.loadURL('cmtest://codex/projects/current')
  await unknown_window.webContents.executeJavaScript(`window.unknownState=${source}; true`)
  assert.doesNotMatch(await unknown_window.webContents.executeJavaScript(`document.querySelector('main').getAttribute('data-cm-theme-part')`), /(^| )settings( |$)/)
  for (const id of ['settings-input', 'settings-button', 'settings-tab']) {
    assert.equal(await unknown_window.webContents.executeJavaScript(`document.querySelector('#${id}').hasAttribute('data-cm-theme-part')`), false)
  }
  unknown_window.destroy()

  window.destroy()
  console.log('主题语义区域 Electron DOM 测试通过')
  app.exit(0)
}

run().catch(error => {
  console.error('主题语义区域测试失败：', error)
  app.exit(1)
})
