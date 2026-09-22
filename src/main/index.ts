import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'
import { randomUUID } from 'node:crypto'
import { activate, authPath, codexHome, configPath, loadLocalAuth, mergeLocalCredential, refreshAccount } from './codex'
import { activeAccountId, summarize, toImportBundle } from './account'
import { AccountImportService } from './account_import'
import { Vault } from './vault'
import type { AccountCredential, AppSettings, OperationResult, PromptConfig } from '../shared/types'
import { PROMPT_PRESETS } from '../shared/types'
import { restartClient, waitForSafeClientExit } from './clientLifecycle'
import { exportSkills, getSkillDetail, importSkill, listSkills, setSkillEnabled, skillRoots } from './skills'
import { diffMcpBackup, getMcpDetail, mergeMcp, jsonToMcp, listMcpBackups, readMcp, redact, removeMcp, rollbackMcpBackup, saveMcp, setMcpEnabled } from './mcp'
import { export_skin, list_skins, load_skin, render_skin_preview } from './themes'
import { read_local_prompt } from './localPrompt'
import { ThemeRuntime } from './theme_runtime'
import { launch_codex_theme } from './theme_connection'
import { close_owned_inspectors } from './theme_inspector'
import { APP_DATA_DIRECTORY, APP_ID, APP_NAME } from '../shared/branding'
import { createSessionService, sessionProjectId, type SessionService } from './session_service'
import { export_filename } from './session_exporter'
import { createSessionDeletionService, type SessionDeletionService } from './session_deletion'
import { create_memory_service } from './memory_service'
import { create_memory_mutations } from './memory_mutations'
import { register_memory_ipc } from './memory_ipc'
import type { SessionCursor, SessionDeleteRequest, SessionExportRequest, SessionExportScope } from '../shared/types'

app.setName(APP_NAME)
const user_data_path = join(app.getPath('appData'), APP_DATA_DIRECTORY)
mkdirSync(user_data_path, { recursive: true })
app.setPath('userData', user_data_path)
app.setPath('sessionData', user_data_path)

let theme_runtime: ThemeRuntime
let theme_timer: NodeJS.Timeout | undefined

let mainWindow: BrowserWindow | null = null; let tray: Tray | null = null; let vault: Vault; let refreshTimer: NodeJS.Timeout | undefined; let quitting = false; let session_service: SessionService; let session_deletion: SessionDeletionService
const result = async <T>(work: () => Promise<T>): Promise<OperationResult<T>> => { try { return { success: true, data: await work() } } catch (error) { return { success: false, error: error instanceof Error ? error.message : '未知错误' } } }
async function upsert(account: AccountCredential, expectedUpdatedAt?: string): Promise<void> {
  await vault.update(data => {
    const previous = data.accounts.find(item => item.id === account.id)
    // A refresh must not resurrect a deleted account or overwrite a newer import.
    if (expectedUpdatedAt !== undefined && (!previous || previous.updatedAt !== expectedUpdatedAt)) return
    account.createdAt = previous?.createdAt || account.createdAt
    data.accounts = [...data.accounts.filter(item => item.id !== account.id), account]
  })
}

async function updateOne(id: string): Promise<void> {
  const data = await vault.read(); const stored = data.accounts.find(item => item.id === id); if (!stored) throw new Error('账号不存在')
  const expectedUpdatedAt = stored.updatedAt
  let account: AccountCredential = { ...stored, usage: stored.usage ? { ...stored.usage } : undefined, profile: stored.profile ? { ...stored.profile } : undefined }
  try { account = mergeLocalCredential(stored, await loadLocalAuth()) }
  catch { /* 本机未登录或 auth.json 暂不可读时继续使用保险库中的只读凭据 */ }
  try { const updated = await refreshAccount(account, data.settings); await upsert(updated, expectedUpdatedAt) }
  catch (error) {
    account.lastError = error instanceof Error ? error.message : '刷新失败'; account.updatedAt = new Date().toISOString()
    await upsert(account, expectedUpdatedAt); throw error
  }
}
async function refreshAll(): Promise<number> {
  const data = await vault.read(); let succeeded = 0
  for (const account of data.accounts) { try { await updateOne(account.id); succeeded += 1 } catch { /* 错误已写入对应账号 */ } }
  mainWindow?.webContents.send('accounts:changed'); return succeeded
}
async function scheduleRefresh(): Promise<void> { if (refreshTimer) clearInterval(refreshTimer); const { settings } = await vault.read(); if (settings.autoRefresh) refreshTimer = setInterval(() => void refreshAll(), Math.max(1, settings.refreshMinutes) * 60_000) }

function registerIpc(): void {
  const memory_service = create_memory_service()
  const memory_mutations = create_memory_mutations(memory_service, join(app.getPath('userData'), 'memory-backups'))
  register_memory_ipc(memory_service, memory_mutations, async action => {
    await waitForSafeClientExit(async () => {
      if (!mainWindow) return false
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Codex 仍在运行', message: `即将${action}本地记忆文件`,
        detail: '建议先等待任务结束并正常退出 Codex，以减少并发写入。管理器会复核文件指纹，但不能阻止外部程序同时写入；不会强制结束或重启 Codex。',
        buttons: ['仍然继续', '取消操作'], defaultId: 1, cancelId: 1, noLink: true,
      })
      return choice.response === 0
    }, { warnOnly: true })
  })
  ipcMain.handle('skins:status', () => result(() => theme_runtime.status()))
  ipcMain.handle('skins:backup', () => result(() => theme_runtime.backup()))
  ipcMain.handle('skins:removeBackup', (_event, id: string) => result(() => theme_runtime.remove_backup(id)))
  ipcMain.handle('skins:apply', (_event, id: string) => result(() => theme_runtime.apply(id)))
  ipcMain.handle('skins:restore', (_event, id: string) => result(() => theme_runtime.restore(id)))
  ipcMain.handle('skins:launch', () => result(() => launch_codex_theme()))
  ipcMain.handle('skins:setMotion', (_event, enabled: boolean) => result(() => theme_runtime.set_motion(enabled)))
  ipcMain.handle('sessions:list', () => result(() => session_service.list()))
  ipcMain.handle('sessions:detail', (_event, id: string, cursor?: SessionCursor) => result(() => session_service.detail(id, undefined, cursor)))
  ipcMain.handle('sessions:refresh', () => result(() => session_service.refresh()))
  ipcMain.handle('sessions:deletePreview', (_event, input: { sessionId: string; selectedBlockIds: string[] }) => result(() => {
    if (!input || typeof input.sessionId !== 'string' || !Array.isArray(input.selectedBlockIds)) throw new Error('删除预览参数无效')
    return session_deletion.preview(input)
  }))
  const ensure_codex_closed = async (): Promise<void> => {
    await waitForSafeClientExit(async stillRunning => {
      if (!mainWindow) return false
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Codex 仍在运行',
        message: stillRunning ? '仍检测到 Codex 客户端正在运行，建议先退出后再操作' : '即将修改本地 Session 文件',
        detail: `删除或恢复会直接修改本地 Session 文件。继续操作可能与 Codex 的写入发生并发冲突，应用会执行指纹复核，但仍建议先等待任务完成并正常退出 Codex。${APP_NAME} 不会强制结束或自动重启 Codex。`,
        buttons: ['仍然继续', '取消操作'], defaultId: 1, cancelId: 1, noLink: true,
      })
      return choice.response === 0
    }, { warnOnly: true })
  }
  ipcMain.handle('sessions:delete', (_event, request: SessionDeleteRequest) => result(async () => {
    if (!request || typeof request.sessionId !== 'string' || !Array.isArray(request.selectedBlockIds) || typeof request.previewToken !== 'string') throw new Error('删除参数无效')
    await ensure_codex_closed(); return session_deletion.delete(request)
  }))
  ipcMain.handle('sessions:backups', (_event, sessionId?: string) => result(() => session_deletion.backups(typeof sessionId === 'string' ? sessionId : undefined)))
  ipcMain.handle('sessions:backupDelete', (_event, operationId: string) => result(() => session_deletion.removeBackup(operationId)))
  ipcMain.handle('sessions:restore', (_event, operationId: string) => result(async () => { if (typeof operationId !== 'string' || !operationId.trim()) throw new Error('备份标识无效'); await ensure_codex_closed(); return session_deletion.restore(operationId) }))
  ipcMain.handle('sessions:export', (_event, request: SessionExportRequest) => result(async () => {
    if (!mainWindow) throw new Error('窗口不可用')
    const scopes: SessionExportScope[] = ['user', 'conversation', 'with_tools', 'raw']
    if (!request || !scopes.includes(request.scope)) throw new Error('导出范围无效')
    const catalog = await session_service.list()
    let wanted = catalog.sessions
    if (request.projectId) wanted = wanted.filter(session => sessionProjectId(session.projectPath) === request.projectId)
    if (request.sessionIds) {
      const ids = new Set(Array.isArray(request.sessionIds) ? request.sessionIds : [])
      wanted = wanted.filter(session => ids.has(session.id))
    }
    if (!wanted.length) throw new Error('没有可导出的会话')
    const selected = await dialog.showSaveDialog(mainWindow, { title: '导出 Codex 会话', defaultPath: export_filename(wanted), filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (selected.canceled || !selected.filePath) return 0
    return session_service.export_file(request, selected.filePath)
  }))
  ipcMain.handle('accounts:list', () => result(async () => {
    const data = await vault.read(); let detected: string | undefined
    try { detected = activeAccountId(JSON.parse(await readFile(authPath(), 'utf8')), data.accounts) } catch { detected = undefined }
    if (data.activeId !== detected) await vault.update(current => { current.activeId = detected })
    return data.accounts.map(account => summarize(account, detected))
  }))
  const account_imports = new AccountImportService(vault)
  app.on('web-contents-created', (_event, contents) => {
    const owner = contents.id
    contents.once('destroyed', () => account_imports.cancel(owner))
    contents.on('did-start-navigation', (_event, _url, _in_place, main_frame) => { if (main_frame) account_imports.cancel(owner) })
  })
  const preview_json = (owner: number, raw: string) => {
    account_imports.cancel(owner)
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw Error('JSON 格式无效，请检查引号、逗号和括号；完整解析后才能逐条校验。') }
    return account_imports.preview(owner, parsed)
  }
  ipcMain.handle('accounts:importText', (event, raw: string) => result(() => preview_json(event.sender.id, raw)))
  ipcMain.handle('accounts:importFile', event => result(async () => {
    if (!mainWindow) throw Error('窗口不可用')
    account_imports.cancel(event.sender.id)
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (selected.canceled) return null
    const raw = await readFile(selected.filePaths[0], 'utf8')
    if (event.sender.isDestroyed()) throw Error('导入窗口已关闭')
    return preview_json(event.sender.id, raw)
  }))
  ipcMain.handle('accounts:importLocal', event => result(async () => {
    account_imports.cancel(event.sender.id)
    const raw = await readFile(authPath(), 'utf8')
    if (event.sender.isDestroyed()) throw Error('导入窗口已关闭')
    return preview_json(event.sender.id, raw)
  }))
  ipcMain.handle('accounts:confirmImport', (event, preview_id: string) => result(() => account_imports.confirm(event.sender.id, preview_id)))
  ipcMain.handle('accounts:cancelImport', (event, preview_id: string) => result(async () => account_imports.cancel(event.sender.id, preview_id)))
  ipcMain.handle('accounts:activate', (_event, id: string) => result(async () => {
    const initial = await vault.read(); if (!initial.accounts.some(item => item.id === id)) throw new Error('账号不存在')
    const runningClient = await waitForSafeClientExit(async (stillRunning) => {
      if (!mainWindow) return false
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '请先安全退出 Codex',
        message: stillRunning ? '仍检测到 Codex 客户端正在运行' : '切换前需要退出 Codex 客户端',
        detail: `请先等待正在执行的任务完成，保存重要内容，然后在 Codex 客户端中正常退出。${APP_NAME} 不会自动关闭或强制结束客户端；退出后点击“已退出，重新检测”。`,
        buttons: ['已退出，重新检测', '取消切换'], defaultId: 0, cancelId: 1, noLink: true
      })
      return choice.response === 0
    })
    try {
      await vault.update(async data => { const account = data.accounts.find(item => item.id === id); if (!account) throw new Error('账号不存在'); await activate(account); data.activeId = id })
    } finally { restartClient(runningClient) }
  }))
  ipcMain.handle('accounts:refresh', (_event, id: string) => result(() => updateOne(id)))
  ipcMain.handle('accounts:refreshAll', () => result(refreshAll))
  ipcMain.handle('accounts:remove', (_event, id: string) => result(async () => { await vault.update(data => { data.accounts = data.accounts.filter(item => item.id !== id); if (data.activeId === id) data.activeId = undefined }) }))
  ipcMain.handle('accounts:removeMany', (_event, ids: string[]) => result(async () => { const wanted = new Set(Array.isArray(ids) ? ids : []); if (!wanted.size) throw new Error('请先选择要删除的账号'); return vault.update(data => { const count = data.accounts.filter(item => wanted.has(item.id)).length; data.accounts = data.accounts.filter(item => !wanted.has(item.id)); if (data.activeId && wanted.has(data.activeId)) data.activeId = undefined; return count }) }))
  ipcMain.handle('accounts:export', (_event, ids: string[]) => result(async () => {
    if (!mainWindow) throw new Error('窗口不可用')
    const wanted = new Set(Array.isArray(ids) ? ids : []); if (!wanted.size) throw new Error('请先选择要导出的账号')
    const data = await vault.read(); const accounts = data.accounts.filter(item => wanted.has(item.id))
    const payload = toImportBundle(accounts)
    const selected = await dialog.showSaveDialog(mainWindow, { title: '导出账号', defaultPath: `codex-accounts-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePath) return 0
    await writeFile(selected.filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'w' }); return accounts.length
  }))
  ipcMain.handle('settings:get', () => result(async () => (await vault.read()).settings))
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => result(async () => { if (settings.proxyEnabled) { const url = new URL(settings.proxyUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('代理地址必须是有效的 HTTP/HTTPS 地址') }; await vault.update(data => { if (data.settings.startAtLogin !== settings.startAtLogin) app.setLoginItemSettings({ openAtLogin: settings.startAtLogin }); data.settings = settings }); await scheduleRefresh() }))
  ipcMain.handle('app:info', () => ({ authPath: authPath(), configPath: configPath(), encryptionAvailable: safeStorage.isEncryptionAvailable() }))
  ipcMain.handle('extensions:info', () => ({ configPath: configPath(), skillRoots: skillRoots() }))
  ipcMain.handle('skills:list', () => result(listSkills))
  ipcMain.handle('skills:detail', (_event, path: string) => result(() => getSkillDetail(path)))
  ipcMain.handle('skills:setEnabled', (_event, path: string, enabled: boolean) => result(() => setSkillEnabled(path, enabled)))
  ipcMain.handle('skills:import', () => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); const selected = await dialog.showOpenDialog(mainWindow, { title: '导入 Skill', properties: ['openDirectory', 'openFile'], filters: [{ name: 'Skill', extensions: ['zip'] }] }); if (selected.canceled) return 0; const target = await dialog.showMessageBox(mainWindow, { type: 'question', title: '选择 Skill 安装范围', message: 'Skill 将复制到哪个范围？', detail: '用户级适用于所有项目；项目级仅在当前项目使用。', buttons: ['用户级', '项目级', '取消'], defaultId: 0, cancelId: 2 }); if (target.response === 2) return 0; await importSkill(selected.filePaths[0], undefined, target.response === 1 ? 'project' : 'user'); return 1 }))
  ipcMain.handle('skills:export', (_event, paths: string[]) => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); if (!Array.isArray(paths) || !paths.length) throw new Error('请先选择 Skill'); const selected = await dialog.showOpenDialog(mainWindow, { title: '选择导出目录', properties: ['openDirectory', 'createDirectory'] }); if (selected.canceled) return 0; return exportSkills(paths, selected.filePaths[0]) }))
  ipcMain.handle('mcp:list', () => result(async () => ({ servers: (await readMcp()).servers })))
  ipcMain.handle('mcp:detail', (_event, name: string) => result(() => getMcpDetail(name)))
  ipcMain.handle('mcp:setEnabled', (_event, name: string, enabled: boolean) => result(() => setMcpEnabled(name, enabled)))
  ipcMain.handle('mcp:save', (_event, name: string, value: unknown) => result(() => saveMcp(name, value)))
  ipcMain.handle('mcp:remove', (_event, name: string) => result(() => removeMcp(name)))
  ipcMain.handle('mcp:backups', () => result(listMcpBackups))
  ipcMain.handle('mcp:rollback', (_event, name: string) => result(() => rollbackMcpBackup(name)))
  ipcMain.handle('mcp:diff', (_event, name: string) => result(() => diffMcpBackup(name)))
  ipcMain.handle('mcp:importJson', (_event, raw: string) => result(async () => { const servers = jsonToMcp(JSON.parse(raw)); await mergeMcp(servers); return Object.keys(servers).length }))
  ipcMain.handle('mcp:exportJson', () => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); const current = await readMcp(); const selected = await dialog.showSaveDialog(mainWindow, { title: '导出 MCP 配置', defaultPath: 'mcp-servers.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (selected.canceled || !selected.filePath) return 0; await writeFile(selected.filePath, `${JSON.stringify(redact({ mcpServers: current.raw.mcp_servers || {} }), null, 2)}\n`, 'utf8'); return current.servers.length }))
  ipcMain.handle('mcp:importFile', () => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); const selected = await dialog.showOpenDialog(mainWindow, { title: '导入 MCP 配置文件', properties: ['openFile'], filters: [{ name: 'MCP 配置', extensions: ['json', 'toml'] }] }); if (selected.canceled || !selected.filePaths[0]) return 0; const file = selected.filePaths[0]; const raw = await readFile(file, 'utf8'); const parsed = extname(file).toLowerCase() === '.toml' ? parseToml(raw) : JSON.parse(raw); const servers = jsonToMcp(parsed); const preview = JSON.stringify(redact({ mcpServers: servers }), null, 2); const confirm = await dialog.showMessageBox(mainWindow, { type: 'info', title: '确认导入 MCP', message: `将合并 ${Object.keys(servers).length} 个 MCP 服务`, detail: `${preview.slice(0, 4000)}${preview.length > 4000 ? '\n…（预览已截断）' : ''}`, buttons: ['导入并备份', '取消'], defaultId: 0, cancelId: 1 }); if (confirm.response !== 0) return 0; await mergeMcp(servers); return Object.keys(servers).length }))
  ipcMain.handle('mcp:exportToml', () => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); const current = await readMcp(); const selected = await dialog.showSaveDialog(mainWindow, { title: '导出 MCP TOML 配置', defaultPath: 'config.mcp.toml', filters: [{ name: 'TOML', extensions: ['toml'] }] }); if (selected.canceled || !selected.filePath) return 0; const document = { mcp_servers: redact(current.raw.mcp_servers || {}) }; await writeFile(selected.filePath, `${stringifyToml(document as any)}\n`, 'utf8'); return current.servers.length }))
  ipcMain.handle('skins:list', () => result(() => list_skins()))
  ipcMain.handle('skins:preview', (_event, id: string) => result(() => load_skin(id)))
  ipcMain.handle('skins:renderPreview', (_event, id: string, mode: 'light' | 'dark', view: 'home' | 'task' | 'settings' | 'components', motion_enabled: boolean) => result(() => render_skin_preview(id, mode, view, motion_enabled)))
  ipcMain.handle('skins:export', (_event, id: string) => result(async () => {
    if (!mainWindow) throw new Error('窗口不可用')
    const skin = await load_skin(id)
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: '导出皮肤主题包', defaultPath: `${skin.id}.${skin.package_extension}`,
      filters: [{ name: 'Codex-Manager 原创主题包', extensions: [skin.package_extension] }]
    })
    if (selected.canceled || !selected.filePath) return 0
    await writeFile(selected.filePath, await export_skin(id))
    return 1
  }))
  ipcMain.handle('prompt:get', () => result(async () => (await vault.read()).prompt!))
  ipcMain.handle('prompt:save', (_event, content: string) => result(async () => { if (!content?.trim()) throw new Error('提示词不能为空'); return vault.update(data => { const current = data.prompt!; const next: PromptConfig = { ...current, content, history: [...current.history, { id: randomUUID(), content, createdAt: new Date().toISOString() }].slice(-20) }; data.prompt = next; return next }) }))
  ipcMain.handle('prompt:reset', () => result(async () => { return vault.update(data => { const current = data.prompt!; const next: PromptConfig = { ...current, content: current.original, history: [...current.history, { id: randomUUID(), content: current.original, createdAt: new Date().toISOString() }].slice(-20) }; data.prompt = next; return next }) }))
  ipcMain.handle('prompt:presets', async () => {
    const data = await vault.read()
    const local = await read_local_prompt(codexHome(), data.prompt?.content || '')
    const current = { id: 'local-current', name: '本机当前提示词', description: '读取本机 Codex 当前指向的 instructions 文件；未找到时显示应用已保存草稿。', content: local.content, source: local.source, sourceWarning: local.source_warning, scenario: '当前配置' }
    const seen = new Set([current.content])
    return [current, ...PROMPT_PRESETS.filter(preset => { if (seen.has(preset.content)) return false; seen.add(preset.content); return true })]
  })
  ipcMain.handle('prompt:export', () => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); const data = await vault.read(); const selected = await dialog.showSaveDialog(mainWindow, { title: '导出提示词', defaultPath: 'codex-prompts.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (selected.canceled || !selected.filePath) return 0; await writeFile(selected.filePath, `${JSON.stringify({ version: 1, prompt: data.prompt }, null, 2)}\n`, 'utf8'); return 1 }))
  ipcMain.handle('prompt:import', () => result(async () => { if (!mainWindow) throw new Error('窗口不可用'); const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); if (selected.canceled) return 0; const imported = JSON.parse(await readFile(selected.filePaths[0], 'utf8')) as { prompt?: PromptConfig }; if (!imported.prompt?.content?.trim()) throw new Error('提示词文件格式无效'); await vault.update(data => { data.prompt = { content: imported.prompt!.content, original: typeof imported.prompt!.original === 'string' ? imported.prompt!.original : data.prompt!.original, history: Array.isArray(imported.prompt!.history) ? imported.prompt!.history.filter(item => typeof item.content === 'string' && typeof item.id === 'string' && Number.isFinite(Date.parse(item.createdAt))).slice(-20) : [] } }); return 1 }))
}

function showWindow(): void { if (!mainWindow) createWindow(); mainWindow?.show(); mainWindow?.focus() }
function createTray(): void { const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')).resize({ width: 20, height: 20 }); tray = new Tray(icon); tray.setToolTip(APP_NAME); tray.setContextMenu(Menu.buildFromTemplate([{ label: `打开 ${APP_NAME}`, click: showWindow }, { label: '刷新全部账号', click: () => void refreshAll() }, { type: 'separator' }, { label: '退出', click: () => { quitting = true; app.quit() } }])); tray.on('double-click', showWindow) }
function createWindow(): void {
  mainWindow = new BrowserWindow({ width: 1240, height: 820, minWidth: 920, minHeight: 650, show: false, backgroundColor: '#eef2fb', icon: join(__dirname, '../../resources/icon.png'), titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#60657b', height: 44 }, webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true } })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-prevent-unload', event => {
    if (!mainWindow) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', title: '保留未完成的记忆操作',
      message: '记忆页面有未保存的草稿或尚未完成的操作',
      detail: '继续关闭或重新加载会丢失未保存的草稿；正在执行的文件操作也可能被中断。',
      buttons: ['留在页面', '仍然离开'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (choice === 1) event.preventDefault()
    else quitting = false
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show()); mainWindow.on('close', event => { if (!quitting && tray) { event.preventDefault(); void vault.read().then(data => { if (data.settings.minimizeToTray) mainWindow?.hide(); else { quitting = true; app.quit() } }) } }); mainWindow.on('closed', () => { mainWindow = null })
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => { electronApp.setAppUserModelId(APP_ID); vault = new Vault(); session_service = createSessionService(); session_deletion = createSessionDeletionService({ resolveFiles: id => session_service.files(id), backupRoot: join(app.getPath('userData'), 'session-backups') }); theme_runtime = new ThemeRuntime(join(app.getPath('userData'), 'theme-backups')); await theme_runtime.resume(); theme_timer = setInterval(() => void theme_runtime.maintain(), 10000); registerIpc(); createWindow(); createTray(); await scheduleRefresh(); app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window)); app.on('activate', showWindow) })
app.on('before-quit', () => { quitting = true })
let inspector_shutdown_complete = false
app.on('will-quit', event => {
  if (theme_timer) clearInterval(theme_timer)
  if (inspector_shutdown_complete) return
  event.preventDefault()
  void close_owned_inspectors().catch(() => { /* 无法关闭的端点不通过终止客户端清理。 */ }).finally(() => { inspector_shutdown_complete = true; app.quit() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit() })
