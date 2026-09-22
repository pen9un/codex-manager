// 使用真实生产构建和 IPC，所有文件与网络均限制在合成测试环境。
const { app, dialog, safeStorage, nativeTheme, shell } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { unzipSync } = require('fflate')
const { parse } = require('@iarna/toml')
const main_bundle = path.resolve(__dirname, '../out/main/index.js')
const report_root = path.resolve(__dirname, '../reports')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run_suite(scope = 'full', main_bundle_path = main_bundle) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-redesign-'))
  const output = path.join(report_root, `redesign-${scope}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await fs.mkdir(output, { recursive: true })
  const codex = path.join(sandbox, '.codex'), home = path.join(sandbox, 'home'), app_data = path.join(sandbox, 'app-data'), user_data = path.join(app_data, 'Codex-Manager')
  const skill_path = path.join(home, '.agents/skills/example'), export_dir = path.join(sandbox, 'exports')
  await fs.mkdir(skill_path, { recursive: true }); await fs.mkdir(codex); await fs.mkdir(user_data, { recursive: true }); await fs.mkdir(export_dir)
  await fs.writeFile(path.join(skill_path, 'SKILL.md'), '---\nname: example\ndescription: 隔离测试技能\n---\n# 工程手册\n\n| 项目 | 状态 |\n| --- | --- |\n| 文档 | 可用 |\n\n- [x] 完成\n\n```js\nconst safe = true\n```\n\n<script>throw Error("不应执行")</script>\n[危险](javascript:alert(1))')
  await fs.mkdir(path.join(skill_path, 'assets')); await fs.writeFile(path.join(skill_path, 'assets/binary.bin'), Buffer.from([0, 1, 255, 0]))
  const config_text = 'model = "fixture-model"\nmodel_instructions_file = "current.md"\n[mcp_servers.docs]\ncommand = "node"\nargs = ["server.js"]\n[mcp_servers.docs.env]\nAPI_KEY = "synthetic-secret"\n'
  await fs.writeFile(path.join(codex, 'config.toml'), config_text)
  await fs.writeFile(path.join(codex, 'current.md'), '# 本机当前指令\n\n先理解，再验证。')
  const auth_text = JSON.stringify({ tokens: { account_id: 'active' } })
  await fs.writeFile(path.join(codex, 'auth.json'), auth_text)
  const invalid_mcp = path.join(sandbox, 'invalid.json'), invalid_skill = path.join(sandbox, 'invalid.zip')
  await fs.writeFile(invalid_mcp, '{invalid'); await fs.writeFile(invalid_skill, 'invalid')
  const incoming_skill = path.join(sandbox, 'incoming-skill'); await fs.mkdir(incoming_skill)
  await fs.writeFile(path.join(incoming_skill, 'SKILL.md'), '---\nname: imported-example\ndescription: 导入验证\n---\n# 示例')
  const report = { scope, main_bundle: main_bundle_path, sandbox, output, scenarios: [], failures: [], console_errors: [], dialogs: [], network: [], external_links: [], startup_changes: [] }
  const dialog_queue = []
  const take_dialog = kind => { const item = dialog_queue.shift(); assert.ok(item, `缺少${kind}对话框测试返回值`); assert.equal(item.kind, kind); report.dialogs.push(item); return item }
  dialog.showOpenDialog = async () => { const item = take_dialog('open'); return { canceled: !!item.cancel, filePaths: item.cancel ? [] : [item.path] } }
  dialog.showSaveDialog = async () => { const item = take_dialog('save'); return { canceled: !!item.cancel, filePath: item.path } }
  dialog.showMessageBox = async () => ({ response: 0 })
  shell.openExternal = async url => { report.external_links.push(url) }
  app.setLoginItemSettings = settings => report.startup_changes.push(settings)
  // 不枚举或重启真实客户端，账号切换只接触临时认证文件。
  require('node:child_process').execFile = (...args) => { const callback = args.at(-1); callback(null, '[]', ''); return {} }
  // 发布归档有独立依赖副本，必须替换被测入口实际解析到的网络模块。
  require('node:module').createRequire(main_bundle_path)('undici').fetch = async (url, options) => {
    report.network.push({ url, account: options.headers['chatgpt-account-id'] })
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage')
    const failed = options.headers['chatgpt-account-id'] === 'error'
    return { ok: !failed, status: failed ? 401 : 200, json: async () => ({ plan_type: 'pro', rate_limit: { primary_window: { used_percent: 23, limit_window_seconds: 604800 }, secondary_window: { used_percent: 12, limit_window_seconds: 18000 } } }) }
  }
  process.env.CODEX_HOME = codex; delete process.env.ELECTRON_RENDERER_URL
  os.homedir = () => home; process.chdir(sandbox); app.setPath('appData', app_data); app.setPath('userData', user_data); app.setPath('sessionData', user_data)
  await app.whenReady()
  const account = (id, extra = {}) => ({ id: require('node:crypto').createHash('sha256').update(id).digest('hex').slice(0, 20), accountId: id, email: `${id}@example.com`, planType: 'pro', accessToken: 'synthetic-access', idToken: 'synthetic-id', refreshToken: 'synthetic-refresh', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z', profile: { authProvider: 'google', organizationTitle: 'Personal' }, ...extra })
  const accounts = [account('active', { usage: { fetchedAt: '2026-09-17T00:00:00Z', primary: { usedPercent: 11, windowSeconds: 604800 }, secondary: { usedPercent: 4, windowSeconds: 18000 } } }), account('valid'), account('expired', { expiresAt: '2020-01-01T00:00:00Z' }), account('error', { lastError: '401：登录凭据已过期' }), account('unknown', { expiresAt: undefined }), account('long', { email: 'a-very-long-account-name-for-layout-check@engineering.example.com', planType: 'business', profile: { organizationTitle: '研发与交付团队', authProvider: 'microsoft' } })]
  await fs.writeFile(path.join(user_data, 'accounts.vault'), safeStorage.encryptString(JSON.stringify({ accounts, settings: { autoRefresh: false, minimizeToTray: false }, prompt: { content: '# 工作指令\n\n清晰表达，谨慎修改。', original: '# 原始指令', history: [] } })).toString('base64'))
  const timeout = setTimeout(() => { console.error('界面验证超时'); app.exit(2) }, 240000)
  app.once('browser-window-created', (_event, win) => {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.on('console-message', event => { if (event.level === 'error') report.console_errors.push(event.message) })
    win.webContents.once('did-finish-load', async () => {
      const js = code => win.webContents.executeJavaScript(code, true)
      const until = async code => { for (let count = 0; count < 100; count++) { if (await js(code)) return; await pause(50) } throw Error(`等待界面条件超时：${code}`) }
      const click = async (label, parent = '.content') => {
        await js(`(()=>{const elements=[...document.querySelectorAll(${JSON.stringify(parent + ' button')})].filter(element=>element.textContent.trim()===${JSON.stringify(label)});if(elements.length!==1)throw Error('按钮数量不匹配：'+elements.length);elements[0].click()})()`)
        await pause(70)
      }
      const by_label = async label => { await js(`document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`); await pause(70) }
      const input = async (selector, value) => { await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const type=element instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}))})()`); await pause(70) }
      const key = async (key_code, modifiers = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key_code, modifiers }); if (key_code === 'Enter' || key_code === 'Space') win.webContents.sendInputEvent({ type: 'char', keyCode: key_code === 'Enter' ? '\r' : ' ', modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key_code, modifiers }); await pause(80) }
      const clear_notice = async () => { await js('document.querySelectorAll(".notice button").forEach(button=>button.click())') }
      const nav = async name => { await by_label(name); await until(`document.querySelector('nav button[aria-current="page"]').getAttribute('aria-label')===${JSON.stringify(name)}`); await pause(100); await clear_notice() }
      const idle = () => until('!document.querySelector(".content [aria-busy=true]")')
      const capture = async name => { win.focus(); await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await pause(200); const filename = `${name.replace(/[^\w\u4e00-\u9fff-]/g, '_')}.png`; await fs.writeFile(path.join(output, filename), (await win.webContents.capturePage()).toPNG()); return filename }
      const scenario = async (name, work) => {
        try { const details = await work(); report.scenarios.push({ name, passed: true, details, screenshot: await capture(name) }) }
        catch (error) { report.key_events = await js('window.__keys'); report.failures.push({ name, error: String(error) }); report.scenarios.push({ name, passed: false, screenshot: await capture(name) }); throw error }
      }
      const confirm_cancel = async () => { await until('!!document.querySelector(".confirm-dialog")'); await key('Escape'); await until('!document.querySelector(".confirm-dialog")') }
      const vault = async () => JSON.parse(safeStorage.decryptString(Buffer.from(await fs.readFile(path.join(user_data, 'accounts.vault'), 'utf8'), 'base64')))
      try {
        win.show(); win.focus(); win.setContentSize(1280, 900)
        await until('document.querySelectorAll(".account").length===6')
        await scenario('应用名称与数据目录', async () => {
          assert.equal(app.getName(), 'Codex-Manager')
          assert.equal(app.getPath('userData'), user_data)
          assert.equal(app.getPath('sessionData'), user_data)
          assert.equal(win.getTitle(), 'Codex-Manager')
          assert.equal(await js('document.querySelector(".brand-text b").textContent'), 'Codex Manager')
          await nav('关于')
          assert.equal(await js('document.querySelector(".about-product h2").textContent'), 'Codex Manager')
          await nav('账号管理')
        })
        if (scope === 'scaling') {
          for (const width of [920, 1280, 1600]) {
            win.setContentSize(width, 650)
            for (const page of ['账号管理', '会话管理', '提示词', 'MCP / Skills', '主题', '应用设置', '关于']) await scenario(`${width}-650-${page}`, async () => {
              await nav(page); await idle(); await pause(120)
              const metrics = await js(`({ ratio:devicePixelRatio, width:innerWidth, height:innerHeight, overflow:document.querySelector('.content').scrollWidth>document.querySelector('.content').clientWidth+2 })`)
              assert.equal(metrics.ratio, Number(app.commandLine.getSwitchValue('force-device-scale-factor')))
              assert.equal(metrics.overflow, false)
              return metrics
            })
          }
          await scenario('账号列表搜索与键盘取消', async () => {
            await nav('账号管理'); await by_label('列表布局'); await until('!!document.querySelector(".accounts.list")')
            await capture('账号列表布局')
            await input('input[aria-label="搜索账号"]', '没有这个账号')
            assert.match(await js('document.querySelector(".empty-state").textContent'), /没有找到/)
            await click('清除搜索'); await by_label('active@example.com 更多操作'); await click('移除账号', '[role=menu]')
            await until('!!document.querySelector(".confirm-dialog")'); await key('Enter')
            await until('!document.querySelector(".confirm-dialog")'); assert.equal((await vault()).accounts.length, 6)
            await by_label('卡片布局'); await until('!!document.querySelector(".accounts.cards")')
          })
        } else {
        if (scope === 'full') {
          await scenario('账号紧凑布局', async () => { assert.equal(await js('getComputedStyle(document.querySelector(".accounts")).gridTemplateColumns.split(" ").length'), 2); assert.equal(await js('!!document.querySelector(".account-drawer")'), false); assert.equal(await js('[...document.querySelectorAll(".identity h2")].some(element=>element.scrollWidth>element.clientWidth)'), true) })
          await scenario('账号查询与错误反馈', async () => { await js('document.querySelector(".account .card-actions button").click()'); await idle(); assert.ok(report.network.length); await js('[...document.querySelectorAll(".account")].find(element=>element.textContent.includes("error@example.com")).querySelector(".card-actions button").click()'); await idle(); assert.match(await js('document.querySelector(".notice.error").textContent'), /401/); await clear_notice() })
          await scenario('账号移除取消及焦点', async () => { await by_label('active@example.com 更多操作'); await click('移除账号', '[role=menu]'); await until('!!document.querySelector(".confirm-dialog")'); assert.equal(await js('document.activeElement.textContent'), '取消'); await capture('危险操作确认弹窗'); await key('Tab'); await key('Tab'); assert.ok(await js('!!document.activeElement.closest(".confirm-dialog")')); await confirm_cancel(); assert.equal((await vault()).accounts.length, 6); assert.equal(await js('document.activeElement.getAttribute("aria-label")'), 'active@example.com 更多操作') })
          await scenario('账号选中导出与取消', async () => { await by_label('全选可见账号'); const target = path.join(export_dir, 'accounts.json'); dialog_queue.push({ kind: 'save', path: target }); await click('导出', '.selection-actions'); await idle(); assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).accounts.length, 6); dialog_queue.push({ kind: 'save', cancel: true }); await click('导出', '.selection-actions'); await idle(); assert.equal(await js('!!document.querySelector(".notice")'), false); await click('取消选择', '.selection-actions') })
          await scenario('账号文件导入与隔离切换', async () => { dialog_queue.push({ kind: 'open', path: path.join(export_dir, 'accounts.json') }); await click('账号操作'); await click('导入 JSON 文件', '[role=menu]'); await until('!!document.querySelector(".account-import-preview")'); assert.equal((await vault()).accounts.length, 6); await click('确认导入 6 个账号', '.modal'); await idle(); await until('!document.querySelector(".modal")'); assert.equal((await vault()).accounts.length, 6); await js('[...document.querySelectorAll(".account")].find(element=>element.textContent.includes("valid@example.com")).querySelectorAll(".card-actions button")[1].click()'); await idle(); assert.equal(JSON.parse(await fs.readFile(path.join(codex, 'auth.json'), 'utf8')).tokens.account_id, 'valid'); assert.equal(await fs.readFile(path.join(codex, 'auth.json.bak'), 'utf8'), auth_text) })
          await scenario('账号导入草稿保护', async () => { await click('添加账号'); await input('#account-json', '{invalid'); await click('预览导入', '.modal'); await idle(); assert.ok(await js('!!document.querySelector(".modal .field-error")')); await key('Escape'); await confirm_cancel(); assert.equal(await js('document.querySelector("#account-json").value'), '{invalid'); await key('Escape'); await click('放弃输入', '.confirm-dialog'); await until('!document.querySelector(".modal")'); await clear_notice() })
          await nav('提示词')
          await scenario('只查看模板不提示丢弃且不写入', async () => {
            await until('!!document.querySelector(".prompt-editor textarea")')
            const original = (await vault()).prompt.content
            await js('document.querySelectorAll(".prompt-preset-list button")[1].click()'); await pause(100)
            const template = await js('document.querySelector(".prompt-editor textarea").value')
            await js('document.querySelectorAll(".prompt-preset-list button")[2].click()'); await pause(100)
            assert.equal(await js('!!document.querySelector(".confirm-dialog")'), false)
            assert.notEqual(await js('document.querySelector(".prompt-editor textarea").value'), template)
            await nav('关于'); assert.equal((await vault()).prompt.content, original)
            await nav('提示词')
            await input('.prompt-editor textarea', original + '修改'); await input('.prompt-editor textarea', original)
            await nav('关于'); assert.equal(await js('!!document.querySelector(".confirm-dialog")'), false)
            await nav('提示词')
          })
          await scenario('提示词取消覆盖与离页保护', async () => { await until('!!document.querySelector(".prompt-editor textarea")'); await input('.prompt-editor textarea', '# 未保存草稿'); await js('document.querySelectorAll(".prompt-preset-list button")[1].click()'); await confirm_cancel(); assert.equal(await js('document.querySelector(".prompt-editor textarea").value'), '# 未保存草稿'); await by_label('账号管理'); await confirm_cancel(); assert.equal(await js('document.querySelector("h1").textContent'), '提示词') })
          await scenario('提示词保存导出导入与历史', async () => { await click('保存', '.editor-actions'); await idle(); assert.equal((await vault()).prompt.content, '# 未保存草稿'); assert.equal((await vault()).prompt.history.length, 1); const target = path.join(export_dir, 'prompts.json'); dialog_queue.push({ kind: 'save', path: target }); await click('提示词操作'); await click('导出已保存版本', '[role=menu]'); await idle(); assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).prompt.content, '# 未保存草稿'); await input('.prompt-editor textarea', '不应导出的草稿'); dialog_queue.push({ kind: 'open', path: target }); await click('提示词操作'); await click('导入提示词', '[role=menu]'); await click('放弃更改', '.confirm-dialog'); await idle(); assert.equal(await js('document.querySelector(".prompt-editor textarea").value'), '# 未保存草稿'); await click('历史 1'); await input('.prompt-editor textarea', '历史覆盖前的草稿'); await js('document.querySelector(".history-list button").click()'); await confirm_cancel(); assert.equal(await js('document.querySelector(".prompt-editor textarea").value'), '历史覆盖前的草稿'); await click('提示词操作'); await click('恢复原提示词', '[role=menu]'); await confirm_cancel(); assert.equal(await js('document.querySelector(".prompt-editor textarea").value'), '历史覆盖前的草稿'); await by_label('应用设置'); await click('放弃更改', '.confirm-dialog'); await until('!!document.querySelector(".settings-page")') })
          await scenario('设置实时保存校验与快速离页', async () => {
            assert.equal(await js('[...document.querySelectorAll(".settings-page button")].some(button=>button.textContent==="保存设置")'), false)
            await by_label('启用代理'); await input('#proxy-url', 'invalid'); await pause(500)
            assert.ok(await js('!!document.querySelector("#proxy-error")')); assert.equal((await vault()).settings.proxyEnabled, false)
            await by_label('启用代理'); await by_label('自动更新用量'); await nav('关于')
            assert.equal((await vault()).settings.autoRefresh, true)
            await nav('应用设置'); await click('深色', '.appearance-options')
            await until('window.codexAccounts.getSettings().then(result=>result.data.themeMode==="dark")')
            assert.equal((await vault()).settings.themeMode, 'dark')
            await click('浅色', '.appearance-options'); await click('深色', '.appearance-options'); await click('浅色', '.appearance-options')
            await nav('关于'); assert.equal((await vault()).settings.themeMode, 'light'); await nav('应用设置')
          })
        }
        if (scope === 'full') {
          await scenario('设置保存失败保留输入与持久错误', async () => {
            const original_encrypt = safeStorage.encryptString
            await by_label('启用代理'); await input('#proxy-url', 'http://127.0.0.1:9999')
            safeStorage.encryptString = () => { throw Error('合成测试：系统安全存储写入失败') }
            try {
              await until('!!document.querySelector(".notice.error")'); await idle()
              assert.equal(await js('document.querySelector("#proxy-url").value'), 'http://127.0.0.1:9999')
              assert.equal((await vault()).settings.proxyEnabled, false)
              await pause(4200)
              assert.match(await js('document.querySelector(".notice.error").textContent'), /系统安全存储写入失败/)
              await capture('设置保存失败状态')
            } finally { safeStorage.encryptString = original_encrypt }
            await click('重试保存'); await until('window.codexAccounts.getSettings().then(result=>result.data.proxyEnabled===true)')
            assert.equal((await vault()).settings.proxyUrl, 'http://127.0.0.1:9999')
            await by_label('启用代理'); await until('window.codexAccounts.getSettings().then(result=>result.data.proxyEnabled===false)')
          })
          await nav('提示词')
          await scenario('提示词模板历史应用与恢复', async () => {
            const config_before = await fs.readFile(path.join(codex, 'config.toml'), 'utf8')
            await js('document.querySelector(".prompt-preset-list button").click()')
            await pause(100); await click('保存', '.editor-actions'); await idle()
            assert.match((await vault()).prompt.content, /本机当前指令/)
            await click('提示词操作'); await click('恢复原提示词', '[role=menu]')
            await click('恢复原提示词', '.confirm-dialog'); await idle()
            assert.equal((await vault()).prompt.content, '# 原始指令')
            assert.equal(await fs.readFile(path.join(codex, 'config.toml'), 'utf8'), config_before)
          })
        }
        await nav('MCP / Skills')
        await scenario('扩展读取失败与恢复', async () => {
          const original_config = await fs.readFile(path.join(codex, 'config.toml'), 'utf8')
          await nav('关于'); await fs.writeFile(path.join(codex, 'config.toml'), '无效 TOML = [')
          await nav('MCP / Skills'); await until('!!document.querySelector(".empty-state button")')
          assert.match(await js('document.querySelector(".empty-state").textContent'), /读取失败/)
          await capture('扩展读取失败状态')
          await fs.writeFile(path.join(codex, 'config.toml'), original_config)
          await click('重新加载'); await until('!!document.querySelector(".interactive-row")'); await clear_notice()
        })
        await scenario('MCP详情键盘与脱敏', async () => { await js("window.__keys=[];['keydown','keyup','click'].forEach(type=>document.addEventListener(type,event=>window.__keys.push({type,key:event.key,code:event.code,target:event.target.className}),true))"); await until('!!document.querySelector(".interactive-row")'); await js('document.querySelector(".interactive-row").focus()'); await key('Enter'); await until('!!document.querySelector(".extension-detail")'); assert.equal(await js('document.querySelector(".extension-detail").textContent.includes("synthetic-secret")'), false); await key('Tab'); await key('Tab', ['shift']); assert.ok(await js('!!document.activeElement.closest(".extension-detail")')); const box = await js('(()=>{const r=document.querySelector(".extension-detail").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight}})()'); assert.ok(Math.abs(box.x + box.w / 2 - box.iw / 2) < 2); assert.ok(Math.abs(box.y + box.h / 2 - box.ih / 2) < 2); assert.ok(box.y >= 50); await capture('MCP居中详情'); await key('Escape'); assert.ok(await js('document.activeElement.classList.contains("interactive-row")')); await key('Space'); await until('!!document.querySelector(".extension-detail")'); await key('Escape') })
        await scenario('MCP编辑失败与草稿保护', async () => { await by_label('docs 更多操作'); await click('编辑配置', '[role=menu]'); await until('!!document.querySelector(".mcp-editor")'); const original = await js('document.querySelector(".mcp-editor textarea").value'); assert.ok(!original.includes('synthetic-secret')); assert.equal(JSON.parse(original).mcpServers.docs.args[0], 'server.js'); await input('.mcp-editor textarea', '{ invalid'); await click('保存配置', '.mcp-editor'); await idle(); assert.equal(await js('document.querySelector(".mcp-editor textarea").value'), '{ invalid'); await capture('MCP编辑错误'); await key('Escape'); await confirm_cancel(); assert.ok(await js('!!document.querySelector(".mcp-editor")')); await input('.mcp-editor textarea', original); await click('取消', '.mcp-editor'); await clear_notice() })
        await scenario('MCP保存与备份回滚', async () => { await by_label('docs 更多操作'); await click('编辑配置', '[role=menu]'); await until('!!document.querySelector(".mcp-editor")'); const raw = JSON.parse(await js('document.querySelector(".mcp-editor textarea").value')); raw.mcpServers.docs.tool_timeout_sec = 45; await input('.mcp-editor textarea', JSON.stringify(raw)); await click('保存配置', '.mcp-editor'); await idle(); let config = parse(await fs.readFile(path.join(codex, 'config.toml'), 'utf8')); assert.equal(config.mcp_servers.docs.env.API_KEY, 'synthetic-secret'); assert.equal(config.mcp_servers.docs.tool_timeout_sec, 45); await click('MCP 操作'); await click('备份与回滚', '[role=menu]'); await until('!!document.querySelector(".backup-panel")'); await click('查看 Diff', '.backup-list'); await idle(); assert.equal(await js('document.querySelector(".backup-diff").textContent.includes("synthetic-secret")'), false); await click('回滚', '.backup-list'); await confirm_cancel(); config = parse(await fs.readFile(path.join(codex, 'config.toml'), 'utf8')); assert.equal(config.mcp_servers.docs.tool_timeout_sec, 45); await click('回滚', '.backup-list'); await click('回滚 MCP', '.confirm-dialog'); await idle(); config = parse(await fs.readFile(path.join(codex, 'config.toml'), 'utf8')); assert.equal(config.model, 'fixture-model'); assert.equal(config.mcp_servers.docs.tool_timeout_sec, undefined) })
        await scenario('MCP导入失败导出与菜单键盘', async () => { await click('MCP 操作'); await key('End'); assert.equal(await js('document.activeElement.textContent'), '备份与回滚'); await key('Home'); assert.equal(await js('document.activeElement.textContent'), '导入配置文件'); await key('ArrowDown'); await key('Escape'); assert.equal(await js('document.activeElement.getAttribute("aria-label")'), 'MCP 操作'); dialog_queue.push({ kind: 'open', path: invalid_mcp }); await click('MCP 操作'); await click('导入配置文件', '[role=menu]'); await idle(); assert.ok(await js('!!document.querySelector(".notice.error")')); const target = path.join(export_dir, 'mcp.toml'); dialog_queue.push({ kind: 'save', path: target }); await click('MCP 操作'); await click('导出 TOML', '[role=menu]'); await idle(); assert.equal((await fs.readFile(target, 'utf8')).includes('synthetic-secret'), false); await clear_notice() })
        await click('Skills1', '.section-tabs')
        await scenario('Skill阅读原文与键盘焦点', async () => { await js('document.querySelector(".interactive-row").click()'); await until('!!document.querySelector(".markdown-preview")'); assert.ok(await js('!!document.querySelector(".markdown-preview table")')); assert.ok(await js('!!document.querySelector(".markdown-preview pre code")')); assert.equal(await js('!!document.querySelector(".markdown-preview script")'), false); await capture('Skill文档抽屉'); await click('原始 SKILL.md'); assert.match(await js('document.querySelector(".extension-detail pre").textContent'), /name: example/); await key('Escape') })
        await scenario('Skill导出保留二进制与启停', async () => { await by_label('全选可见 Skills'); dialog_queue.push({ kind: 'open', path: export_dir }); await click('导出选中'); await idle(); assert.deepEqual(await fs.readFile(path.join(export_dir, 'example/assets/binary.bin')), Buffer.from([0, 1, 255, 0])); await click('停用', '.extension-row'); await idle(); const config = parse(await fs.readFile(path.join(codex, 'config.toml'), 'utf8')); assert.equal(config.skills.config[0].path, path.join(skill_path, 'SKILL.md')); assert.equal(config.skills.config[0].enabled, false) })
        await scenario('Skill无效及有效导入', async () => { dialog_queue.push({ kind: 'open', path: invalid_skill }); await click('导入本地 Skill', '.page-actions'); await idle(); assert.ok(await js('!!document.querySelector(".notice.error")')); dialog_queue.push({ kind: 'open', path: incoming_skill }); await click('导入本地 Skill', '.page-actions'); await idle(); assert.ok(await fs.stat(path.join(home, '.agents/skills/incoming-skill/SKILL.md'))); assert.equal(await js('document.querySelectorAll(".extension-row").length'), 2) })
        await nav('主题')
        await scenario('皮肤图像筛选与搜索', async () => { await until('document.querySelectorAll(".skin-card").length===6'); await until('[...document.querySelectorAll(".skin-card-preview img")].every(image=>image.complete&&image.naturalWidth>0)'); await input('.skin-search input', '机甲猫'); assert.equal(await js('document.querySelectorAll(".skin-card").length'), 1); await input('.skin-search input', ''); await click('Dream Skin', '.skin-source-filter'); assert.equal(await js('document.querySelectorAll(".skin-card").length'), 1); await click('全部来源', '.skin-source-filter') })
        await scenario('六套皮肤逐个预览', async () => { for (let index = 0; index < 6; index++) { await js(`document.querySelectorAll('.skin-card-preview')[${index}].click()`); await until('!!document.querySelector(".skin-preview-modal")'); await capture('皮肤预览-' + index); await click('原始背景', '.skin-preview-tabs'); await click('界面模拟', '.skin-preview-tabs'); assert.ok(await js('!!document.querySelector(".skin-simulator")')); await key('Tab'); await key('Tab', ['shift']); assert.ok(await js('!!document.activeElement.closest(".skin-preview-modal")')); await key('Escape'); await until('!document.querySelector(".skin-preview-modal")') } })
        await scenario('皮肤导出取消与两种完整包', async () => { dialog_queue.push({ kind: 'save', cancel: true }); await js('document.querySelectorAll(".skin-card-actions button")[1].click()'); await idle(); assert.equal(await js('!!document.querySelector(".notice")'), false); for (const [index, name, files] of [[0, 'dream.zip', ['LICENSE.txt', 'background.jpg', 'manifest.json', 'theme.css', 'theme.json']], [1, 'themes.codextheme', ['LICENSE', 'hero.webp', 'preview.png', 'theme.json']]]) { const target = path.join(export_dir, name); dialog_queue.push({ kind: 'save', path: target }); await js(`document.querySelectorAll('.skin-card')[${index}].querySelectorAll('.skin-card-actions button')[1].click()`); await idle(); assert.deepEqual(Object.keys(unzipSync(await fs.readFile(target))).sort(), files) } await js('document.querySelector(".skin-card-actions a").click()'); await pause(100); assert.ok(report.external_links.some(url => url.startsWith('https://github.com/'))); await clear_notice() })
        if (scope === 'full') {
          await nav('账号管理'); await click('刷新全部'); await idle(); await clear_notice();
            const pages = ['账号管理', '会话管理', '提示词', 'MCP / Skills', '主题', '应用设置', '关于']
          for (const width of [920, 1280, 1600]) for (const [mode, label] of [['light', '浅色'], ['dark', '深色'], ['high-contrast', '高对比']]) {
            win.setContentSize(width, 900); await nav('应用设置'); await click(label, '.appearance-options')
            await until(`window.codexAccounts.getSettings().then(result=>result.data.themeMode===${JSON.stringify(mode)})`)
            for (const page of pages) await scenario(`${width}-${mode}-${page}`, async () => {
              await nav(page); await idle(); await js('document.querySelector(".content").scrollTop=0'); await pause(100)
              const metrics = await js(`(()=>{const selectors=['.content','.content-inner','.toolbar','.account','.prompt-editor','.editor-head','.settings-section','.extension-list'];return{width:innerWidth,theme:document.querySelector('.app-shell').className,overflow:selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(element=>element.scrollWidth>element.clientWidth+2).map(element=>({selector,width:element.clientWidth,scroll:element.scrollWidth}))),columns:document.querySelector('.accounts.cards')?getComputedStyle(document.querySelector('.accounts.cards')).gridTemplateColumns.split(' ').length:null}})()`)
              assert.ok(Math.abs(metrics.width - width) <= 1); assert.deepEqual(metrics.overflow, []); if (metrics.columns) assert.equal(metrics.columns, width === 1600 ? 3 : 2)
              return metrics
            })
          }
          await scenario('跟随系统模式切换', async () => { win.setContentSize(1280, 900); await nav('应用设置'); await click('跟随系统', '.appearance-options'); await until('window.codexAccounts.getSettings().then(result=>result.data.themeMode==="system")'); nativeTheme.themeSource = 'light'; await pause(150); const light = await js('getComputedStyle(document.querySelector(".app-shell")).backgroundColor'); nativeTheme.themeSource = 'dark'; await pause(150); const dark = await js('getComputedStyle(document.querySelector(".app-shell")).backgroundColor'); assert.notEqual(light, dark); nativeTheme.themeSource = 'light'; return { light, dark } })
          await scenario('侧栏快捷键与窄屏偏好保留', async () => { await nav('账号管理'); await key('b', ['alt']); await until('!!document.querySelector(".sidebar-collapsed")'); assert.equal((await vault()).settings.sidebarCollapsed, true); await key('b', ['alt']); await until('!document.querySelector(".sidebar-collapsed")'); win.setContentSize(920, 650); await pause(100); assert.equal(await js('Math.round(document.querySelector(".sidebar").getBoundingClientRect().width)'), 64); assert.equal((await vault()).settings.sidebarCollapsed, false) })
          for (const page of pages) await scenario(`920-650-${page}`, async () => { await nav(page); await idle(); const overflow = await js('document.querySelector(".content").scrollWidth>document.querySelector(".content").clientWidth+2'); assert.equal(overflow, false) })
          for (const zoom of [1, 1.25, 1.5]) await scenario(`缩放-${zoom}`, async () => { win.setContentSize(1280, 900); win.webContents.setZoomFactor(zoom); await nav('账号管理'); await pause(120); assert.equal(await js('document.querySelector(".content").scrollWidth>document.querySelector(".content").clientWidth+2'), false); return { zoom, viewport: await js('innerWidth') } })
          win.webContents.setZoomFactor(1); win.setContentSize(1280, 900)
          await scenario('批量移除与空态', async () => { await nav('账号管理'); await by_label('全选可见账号'); await click('移除', '.selection-actions'); await click('移除账号', '.confirm-dialog'); await idle(); assert.equal((await vault()).accounts.length, 0); assert.ok(await js('!!document.querySelector(".empty-state")')); assert.equal(JSON.parse(await fs.readFile(path.join(codex, 'auth.json'), 'utf8')).tokens.account_id, 'valid') })
        }
        }
        assert.equal(dialog_queue.length, 0)
      } catch (error) {
        if (!report.failures.length) report.failures.push({ name: '运行器', error: String(error) })
        report.failure_state = await js('({page:document.querySelector("h1")?.textContent,status:document.querySelector(".settings-save-bar")?.textContent,notice:document.querySelector(".notice")?.textContent,theme:document.querySelector(".appearance-options [aria-pressed=true]")?.textContent,visibility:document.visibilityState,focused:document.hasFocus()})')
        report.failure_settings = (await vault()).settings
        await capture('运行失败现场')
      }
      report.success = report.failures.length === 0 && report.console_errors.length === 0
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
      clearTimeout(timeout)
      console.log(JSON.stringify({ success: report.success, scenarios: report.scenarios.length, failures: report.failures, console_errors: report.console_errors, output }))
      app.exit(report.success ? 0 : 1)
    })
  })
  require(main_bundle_path)
}
module.exports = { run_suite }
if (require.main === module) run_suite().catch(error => { console.error(error); app.exit(2) })
