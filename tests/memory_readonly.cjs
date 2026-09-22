// 可选本机只读验收：隔离管理器数据，仅调用记忆列表、读取和搜索接口。
const { app, dialog } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-readonly-'))
for (const name of ['app-data', 'bootstrap']) fs.mkdirSync(path.join(sandbox, name))
app.setPath('appData', path.join(sandbox, 'app-data'))
app.setPath('userData', path.join(sandbox, 'bootstrap'))
app.setPath('sessionData', path.join(sandbox, 'bootstrap'))
dialog.showMessageBox = async () => { throw new Error('只读验收禁止任何写入确认') }
const timeout = setTimeout(() => { console.error('本机只读验收超时'); app.exit(2) }, 60000)
app.once('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  try {
    const run = code => window.webContents.executeJavaScript(code)
    const catalog = await run('window.codexMemories.list()')
    assert.equal(catalog.success, true)
    const summary = catalog.data.files.find(file => file.category === 'summary')
    const detail = summary ? await run(`window.codexMemories.read(${JSON.stringify(summary.id)})`) : undefined
    if (detail) assert.equal(detail.success, true)
    const search = await run('window.codexMemories.search("记忆", "all")')
    assert.equal(search.success, true)
    const report = { root: catalog.data.root, files: catalog.data.files.length, categories: Object.fromEntries(['summary', 'long_term', 'raw', 'rollouts', 'skills', 'notes', 'other'].map(category => [category, catalog.data.files.filter(file => file.category === category).length])), summary_bytes: detail?.data.file.size, search_matches: search.data.files.length, warnings: catalog.data.warnings.length + search.data.warnings.length, operations: ['list', 'read', 'search'] }
    fs.writeFileSync(path.resolve(__dirname, '../reports/memory-readonly-result-20260920.json'), JSON.stringify(report, null, 2))
    console.log(`本机记忆只读验证通过：${report.files} 个文件，${report.search_matches} 个搜索匹配，${report.warnings} 项读取提示；未调用写入接口。`)
    clearTimeout(timeout); app.exit(0)
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1) }
}))
require('../out/main/index.js')
