// 隔离账号、认证路径及进程发现，验证真实管理器 IPC 和页面，不连接真实 Codex。
const { app, BrowserWindow, safeStorage, dialog } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const bundle_root = process.argv[2] ? path.resolve(process.argv[2]) : root
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const output = path.join(root, 'reports/account-import-preview-20260922', bundle_root === root ? '' : 'packaged')
const fixture = (account_id = 'sample-account', access_token = '测试凭据') => ({ type: 'codex', email: 'sample@example.com', account_id, access_token, id_token: '测试身份', refresh_token: '测试刷新', expired: '2030-12-31T23:59:59Z' })
const timeout = setTimeout(() => { console.error('管理器验收超时'); app.exit(2) }, 90000)

async function main() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manager-update-ui-'))
  os.homedir = () => sandbox
  process.env.CODEX_HOME = path.join(sandbox, '.codex')
  app.setPath('appData', sandbox)
  app.setPath('userData', sandbox)
  app.setPath('sessionData', sandbox)
  delete process.env.ELECTRON_RENDERER_URL
  require('node:child_process').execFile = (...args) => { args.at(-1)(null, '[]', ''); return {} }
  const directory = path.join(sandbox, 'Codex-Manager/theme-backups')
  await fs.mkdir(directory, { recursive: true })
  const entries = []
  for (const [index, skin_id] of [null, 'fruit-base', 'lulu-duo'].entries()) {
    const entry = { id: `12345678-1234-1234-1234-12345678900${index}`, created_at: new Date().toISOString(), name: '应用主题前自动备份', windows: 1 }
    entries.push(entry)
    await fs.writeFile(path.join(directory, entry.id + '.json'), JSON.stringify({ ...entry, schema: 1, snapshots: [{ skin_id, native_classes: ['light'], attributes: {}, variables: {} }] }))
  }
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(entries))
  await fs.mkdir(output, { recursive: true })
  if (bundle_root !== root) {
    for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
      assert.deepEqual(await fs.readFile(path.join(bundle_root, file)), await fs.readFile(path.join(root, file)))
    }
  }
  require(path.join(bundle_root, 'out/main/index.js'))
  await app.whenReady()
  let window
  for (let attempt = 0; attempt < 100; attempt++) {
    window = BrowserWindow.getAllWindows()[0]
    if (window && !window.webContents.isLoading()) break
    await pause(100)
  }
  const errors = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  const js = async code => {
    try { return await window.webContents.executeJavaScript(code, true) }
    catch (error) { console.error('页面脚本失败：', code, errors); throw error }
  }
  const wait_for = async code => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await js(code)) return; await pause(50) }
    throw Error('等待页面状态超时：' + code)
  }
  const click = async (label, scope = 'document') => {
    const expression = `[...${scope}.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)})`
    await wait_for(`!!${expression} && !${expression}.disabled`)
    await js(`${expression}.click()`)
  }
  const snapshot = async name => {
    await js(`Promise.all(document.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))`)
    await pause(500)
    assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false)
    await fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG())
  }
  await wait_for(`!!document.querySelector('.brand-text b')`)
  assert.equal(await js(`document.querySelector('.brand-text b').textContent`), 'Codex Manager')
  assert.equal(app.getPath('userData'), path.join(sandbox, 'Codex-Manager'))
  await js(`window.codexAccounts.getSettings().then(r=>window.codexAccounts.saveSettings({...r.data,autoRefresh:false}))`)
  await click('添加账号')
  await wait_for(`!!document.querySelector('#account-json')`)
  const placeholder = await js(`document.querySelector('#account-json').placeholder`)
  assert.equal(JSON.parse(placeholder).email, 'you@example.com')
  assert.equal(await js(`document.querySelector('#account-json').value`), '')
  assert.match(await js(`document.querySelector('.account-import-formats').textContent`), /Sub2API、Codex2API/)
  window.setContentSize(920, 650)
  await snapshot('account-import-light-920')
  await js(`document.querySelector('.app-shell').classList.replace('theme-light','theme-dark')`)
  await snapshot('account-import-dark-920')
  await js(`document.querySelector('.app-shell').classList.replace('theme-dark','theme-light')`)
  window.setContentSize(1280, 800)
  await snapshot('account-import-light-1280')
  const first_raw = JSON.stringify([fixture()])
  await js(`(()=>{const node=document.querySelector('#account-json');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,${JSON.stringify(first_raw)});node.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await wait_for(`[...document.querySelectorAll('.dialog-actions button')].some(n=>n.textContent==='预览导入'&&!n.disabled)`)
  await click('预览导入')
  await wait_for(`!!document.querySelector('.account-import-preview')`)
  assert.equal((await js('window.codexAccounts.list()')).data.length, 0)
  await click('确认导入 1 个账号')
  await wait_for(`!document.querySelector('#account-json') && document.querySelectorAll('.account').length===1`)
  const before = (await js(`window.codexAccounts.list()`)).data[0]
  const reimport = await js(`window.codexAccounts.importText(${JSON.stringify(JSON.stringify([fixture('sample-account', '新凭据')]))})`)
  assert.equal(reimport.success, true)
  assert.equal(reimport.data.updated, 1)
  assert.equal((await js(`window.codexAccounts.confirmImport(${JSON.stringify(reimport.data.preview_id)})`)).success, true)
  const read_vault = async () => JSON.parse(safeStorage.decryptString(Buffer.from(await fs.readFile(path.join(sandbox, 'Codex-Manager/accounts.vault'), 'utf8'), 'base64')))
  let stored = (await read_vault()).accounts
  assert.equal(stored.length, 1)
  assert.equal(stored[0].accessToken, '新凭据')
  assert.equal(stored[0].id, before.id)
  assert.equal(stored[0].createdAt, before.createdAt)
  const atomic_before = await fs.readFile(path.join(sandbox, 'Codex-Manager/accounts.vault'), 'utf8')
  const mixed = { accounts: [
    { platform: 'openai', type: 'oauth', credentials: fixture('sample-account', '被后续覆盖') },
    { name: '其它平台账号', platform: 'anthropic', type: 'oauth', credentials: fixture('other-platform') },
    null,
    { name: '不完整账号', platform: 'openai', type: 'oauth', credentials: { email: 'invalid@example.com' } },
    { platform: 'openai', type: 'oauth', credentials: fixture('new-account', '新增凭据') },
    { platform: 'openai', type: 'oauth', credentials: fixture('sample-account', '最后有效凭据') }
  ] }
  const paste = async value => {
    await js(`(()=>{const node=document.querySelector('#account-json');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  }
  await click('添加账号')
  await wait_for(`!!document.querySelector('#account-json')`)
  await paste(JSON.stringify(mixed))
  await click('预览导入')
  await wait_for(`document.querySelectorAll('.import-preview-row').length===6`)
  assert.match(await js(`document.querySelector('.import-preview-summary').textContent`), /新增 1 个 · 更新 1 个 · 跳过 4 条/)
  assert.equal(await fs.readFile(path.join(sandbox, 'Codex-Manager/accounts.vault'), 'utf8'), atomic_before)
  assert.equal(await js(`document.querySelector('.account-import-preview').textContent.includes('最后有效凭据')`), false)
  assert.equal(await js(`document.activeElement===document.querySelector('.import-preview-summary h3')`), true)
  window.setContentSize(920, 650)
  await snapshot('mixed-preview-light-920')
  await js(`document.querySelector('.app-shell').classList.replace('theme-light','theme-dark')`)
  await snapshot('mixed-preview-dark-920')
  await js(`document.querySelector('.app-shell').classList.replace('theme-dark','theme-light')`)
  await click('跳过 4')
  await wait_for(`document.querySelectorAll('.import-preview-row').length===4`)
  assert.match(await js(`document.querySelector('.import-preview-list').textContent`), /非 OpenAI/)
  await snapshot('skipped-rows-920')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait_for(`!document.querySelector('.account-import-preview')`)
  assert.equal(await fs.readFile(path.join(sandbox, 'Codex-Manager/accounts.vault'), 'utf8'), atomic_before)
  await click('添加账号')
  await wait_for(`!!document.querySelector('#account-json')`)
  await paste(JSON.stringify(mixed))
  await click('预览导入')
  await wait_for(`!!document.querySelector('.account-import-preview')`)
  window.setContentSize(1280, 800)
  await snapshot('mixed-preview-light-1280')
  await click('确认导入 2 个账号')
  await wait_for(`!document.querySelector('.account-import-preview') && document.querySelectorAll('.account').length===2`)
  stored = (await read_vault()).accounts
  assert.equal(stored.length, 2)
  assert.equal(stored.find(account=>account.accountId==='sample-account').accessToken, '最后有效凭据')
  assert.match(await js(`document.querySelector('.notice').textContent`), /新增 1 个，更新 1 个，跳过 4 条/)
  await click('添加账号')
  await wait_for(`!!document.querySelector('#account-json')`)
  await paste(JSON.stringify({ accounts: [mixed.accounts[1], mixed.accounts[3]] }))
  await click('预览导入')
  await wait_for(`!!document.querySelector('.account-import-preview')`)
  assert.equal(await js(`[...document.querySelectorAll('.dialog-actions button')].find(n=>n.textContent==='确认导入 0 个账号').disabled`), true)
  await snapshot('all-skipped-1280')
  await click('返回修改')
  await wait_for(`!!document.querySelector('#account-json')`)
  assert.ok(await js(`document.querySelector('#account-json').value.length>0`))
  await paste('合成的无效 JSON 凭据内容')
  await click('预览导入')
  await wait_for(`!!document.querySelector('#import-error')`)
  assert.match(await js(`document.querySelector('#import-error').textContent`), /JSON 格式无效/)
  assert.equal(await js(`document.querySelector('#import-error').textContent.includes('合成的无效')`), false)
  await paste('')
  await click('取消', "document.querySelector('.modal')")
  const file_path = path.join(sandbox, 'export.json')
  await fs.writeFile(file_path, JSON.stringify([fixture('sample-account', '文件凭据')]))
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file_path] })
  const file_preview = await js('window.codexAccounts.importFile()')
  assert.equal(file_preview.success, true)
  assert.equal((await js(`window.codexAccounts.confirmImport(${JSON.stringify(file_preview.data.preview_id)})`)).success, true)
  await fs.mkdir(process.env.CODEX_HOME, { recursive: true })
  await fs.writeFile(path.join(process.env.CODEX_HOME, 'auth.json'), JSON.stringify({ email: 'sample@example.com', tokens: fixture('sample-account', '本机凭据') }))
  const local_preview = await js('window.codexAccounts.importLocal()')
  assert.equal(local_preview.success, true)
  assert.equal((await js(`window.codexAccounts.confirmImport(${JSON.stringify(local_preview.data.preview_id)})`)).success, true)
  stored = (await read_vault()).accounts
  assert.equal(stored.length, 2)
  assert.equal(stored[0].accessToken, '本机凭据')
  await click('关于')
  await wait_for(`!!document.querySelector('.about-product h2')`)
  assert.equal(await js(`document.querySelector('.about-product h2').textContent`), 'Codex Manager')
  assert.equal(await js(`document.querySelector('.about-product p').textContent`), '你的 Codex 管理中心')
  await snapshot('about-1280')
  await click('主题')
  await wait_for(`!![...document.querySelectorAll('button')].find(n=>n.textContent==='主题备份 · 3')`)
  await click('主题备份 · 3')
  await wait_for(`document.querySelectorAll('.theme-backup-row').length===3`)
  assert.equal(await js(`document.querySelector('.theme-backup-row .theme-backup-actions button').disabled`), true)
  assert.equal(await js(`document.querySelector('.theme-backup-row .danger-text').disabled`), false)
  window.setContentSize(920, 650)
  await snapshot('backups-920')
  await js(`document.querySelector('.theme-backup-row .danger-text').click()`)
  await wait_for(`!!document.querySelector('.confirm-dialog')`)
  await click('取消', "document.querySelector('.confirm-dialog')")
  assert.equal((JSON.parse(await fs.readFile(path.join(directory, 'index.json')))).length, 3)
  await js(`document.querySelector('.theme-backup-row .danger-text').click()`)
  await wait_for(`!!document.querySelector('.confirm-dialog')`)
  await snapshot('backup-delete-confirm-920')
  await click('删除备份', "document.querySelector('.confirm-dialog')")
  await wait_for(`document.querySelectorAll('.theme-backup-row').length===2`)
  assert.equal((JSON.parse(await fs.readFile(path.join(directory, 'index.json')))).length, 2)
  assert.equal((await fs.readdir(directory)).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).length, 2)
  assert.equal((await js('window.codexSkins.removeBackup("../index")')).success, false)
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, source: '隔离 Electron 管理器', real_codex_connected: false, checks: ['显示名称与固定存储路径', 'JSON 示例及格式说明', '明暗与窄窗口', '粘贴、文件、本机导入覆盖更新', '预览与取消不写入、确认有效部分、跳过其它平台及坏条目、同批去重、全部无效阻止确认', '断连删除、取消及索引同步', '路径越界拒绝'], console_errors: errors }, null, 2))
  console.log('管理器验收通过：账号三种导入预览、部分导入及取消、去重、备份断连删除、名称与页面布局。')
}
main().then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { console.error('管理器验收失败：', error); app.exit(1) })
