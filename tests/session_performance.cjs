// 默认使用 128MB 脱敏数据；--real 只读本机会话并把导出写入隔离临时目录。
const { app, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const real = process.argv.includes('--real')
const temporary_root = path.resolve(__dirname, '../reports')
fs.mkdirSync(temporary_root, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(temporary_root, 'session-performance-'))
const app_data = path.join(sandbox, 'app-data')
fs.mkdirSync(app_data)
app.setPath('appData', app_data); app.setPath('userData', app_data); app.setPath('sessionData', app_data)
delete process.env.ELECTRON_RENDERER_URL
if (!real) {
  const root = path.join(sandbox, '.codex')
  const directory = path.join(root, 'sessions')
  fs.mkdirSync(directory, { recursive: true })
  process.env.CODEX_HOME = root
  const fd = fs.openSync(path.join(directory, 'rollout-large.jsonl'), 'w')
  const row = (type, payload) => fs.writeSync(fd, JSON.stringify({ type, payload }) + '\n')
  row('session_meta', { id: 'large', cwd: 'D:/性能测试项目' })
  row('response_item', { type: 'message', role: 'user', content: '<recommended_plugins>注入内容</recommended_plugins>\n检查性能' })
  const payload = '工具结果'.repeat(128 * 1024)
  for (let i = 0; i < 86; i++) {
    row('response_item', { type: 'message', role: 'user', content: `执行步骤${i}` })
    row('response_item', { type: 'function_call', call_id: String(i), name: '测试工具', arguments: '{}' })
    row('response_item', { type: 'function_call_output', call_id: String(i), output: payload })
    row('response_item', { type: 'message', role: 'assistant', content: `步骤${i}完成` })
  }
  fs.closeSync(fd)
}
const report = { mode: real ? '真实本机只读' : '合成大文件', timings_ms: {}, counts: {}, export_bytes: {}, assertions: [] }
let export_path
dialog.showSaveDialog = async () => ({ canceled: false, filePath: export_path })
const timeout = setTimeout(() => { console.error('会话性能验证超时'); app.exit(2) }, 180000)
app.once('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  try {
    const run = code => window.webContents.executeJavaScript(code, true)
    const timed = async (label, code) => {
      const start = performance.now(); const result = await run(code)
      report.timings_ms[label] = Math.round(performance.now() - start)
      assert.equal(result.success, true, result.error)
      return result.data
    }
    const catalog = await timed('列表首次', 'window.codexAccounts.sessions.list()')
    await timed('列表复用', 'window.codexAccounts.sessions.list()')
    await timed('刷新', 'window.codexAccounts.sessions.refresh()')
    report.counts = { sessions: catalog.sessions.length, projects: catalog.projects.length, projectless: catalog.sessions.filter(item => !item.projectPath).length }
    if (real) {
      const { DatabaseSync } = require('node:sqlite')
      const root = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
      const names = fs.readdirSync(root).filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))
      const db = new DatabaseSync(path.join(root, names[0]), { readOnly: true })
      const rows = db.prepare('SELECT id, rollout_path FROM threads').all(); db.close()
      const ids = new Set(catalog.sessions.map(item => item.id))
      const missing = rows.filter(item => fs.existsSync(item.rollout_path) && !ids.has(item.id))
      report.counts.indexed_sessions = rows.length
      assert.equal(missing.length, 0, '官方索引中的可读会话不得遗漏')
    }
    assert.ok(report.timings_ms['列表首次'] < 3000, '列表首次应在 3 秒内加载')
    assert.ok(report.timings_ms['列表复用'] < 1000, '复用列表应在 1 秒内加载')
    const largest = [...catalog.sessions].sort((a, b) => b.fileSize - a.fileSize)[0]
    assert.ok(largest, '必须有会话可测')
    report.counts.source_bytes = largest.fileSize
    const first_page = await timed('最大会话首屏', `window.codexAccounts.sessions.detail(${JSON.stringify(largest.id)})`)
    assert.equal(first_page.rawRecords.length, 0)
    assert.ok(report.timings_ms['最大会话首屏'] < 3000, '最大会话首屏应在 3 秒内加载')
    report.counts.first_page_blocks = first_page.blocks.length
    for (const scope of ['user', 'conversation', 'with_tools', 'raw']) {
      export_path = path.join(sandbox, `${scope}.md`)
      await timed(`导出_${scope}`, `window.codexAccounts.sessions.export(${JSON.stringify({ scope, sessionIds: [largest.id] })})`)
      report.export_bytes[scope] = fs.statSync(export_path).size
      fs.unlinkSync(export_path)
      assert.ok(report.export_bytes[scope] > 0)
    }
    report.assertions.push('首次与复用列表耗时达标', '详情首屏耗时达标', '四档导出成功落盘', '预览不携带原始记录')
    const output = path.resolve(__dirname, '../reports', `会话性能-${real ? '真实' : '合成'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ success: true, ...report, report: output }))
    // 只清理本脚本创建的大文件，不移除仍被 Electron 占用的应用目录。
    if (!real) fs.unlinkSync(path.join(sandbox, '.codex', 'sessions', 'rollout-large.jsonl'))
    clearTimeout(timeout); window.destroy(); app.exit(0)
  } catch (error) { console.error('会话性能验证失败：', error, JSON.stringify(report)); app.exit(1) }
}))
require(path.resolve(__dirname, '../out/main/index.js'))
