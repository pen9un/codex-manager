// 用真实生产页面生成 README 配图；全部账号、会话和配置均为合成数据。
const { app, ipcMain, safeStorage, session, shell } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const project_root = path.resolve(__dirname, '..')
const output_root = path.join(project_root, 'docs/images')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  // 可指定不含真实用户名的临时根目录，避免截图中的路径泄露个人信息。
  const temp_root = process.env.README_DEMO_TEMP || os.tmpdir()
  await fs.mkdir(temp_root, { recursive: true })
  const sandbox = await fs.mkdtemp(path.join(temp_root, 'codex-demo-'))
  const home = path.join(sandbox, 'demo-user')
  const codex_home = path.join(home, '.codex')
  const app_data = path.join(sandbox, 'app-data')
  const user_data = path.join(app_data, 'Codex-Manager')
  const write = async (file_path, content) => {
    await fs.mkdir(path.dirname(file_path), { recursive: true })
    await fs.writeFile(file_path, content, 'utf8')
  }
  await fs.mkdir(user_data, { recursive: true })
  await fs.mkdir(output_root, { recursive: true })
  process.env.CODEX_HOME = codex_home
  delete process.env.ELECTRON_RENDERER_URL
  process.env.HOME = home
  process.env.USERPROFILE = home
  os.homedir = () => home
  process.chdir(sandbox)
  app.setPath('appData', app_data)
  app.setPath('userData', user_data)
  app.setPath('sessionData', user_data)
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  // 不调用真实账号接口，不枚举客户端、不启动外部工具。
  require('undici').fetch = async () => { throw Error('演示环境禁止网络请求') }
  require('node:child_process').execFile = (...args) => { args.at(-1)(null, '[]', ''); return {} }
  app.setLoginItemSettings = () => {}
  shell.openExternal = async () => { throw Error('演示环境禁止打开外部链接') }
  await write(path.join(codex_home, 'auth.json'), JSON.stringify({ tokens: { account_id: 'demo-work' } }))
  await write(path.join(codex_home, 'config.toml'), [
    'model_instructions_file = "instructions.md"',
    '[features]', 'memories = true', '[memories]', 'use_memories = true',
    '[mcp_servers.project-docs]', 'command = "node"', 'args = ["demo/docs-server.js"]', 'tool_timeout_sec = 60',
    '[mcp_servers.design-library]', 'url = "https://design.example.com/mcp"', 'tool_timeout_sec = 30',
    '[mcp_servers.local-workspace]', 'command = "node"', 'args = ["demo/workspace-server.js"]',
    '[mcp_servers.release-notes]', 'url = "https://releases.example.com/mcp"', 'enabled = false',
  ].join('\n'))
  const prompt = '# 协作式代码审查\n\n你是一位重视可维护性的代码审查伙伴。请根据当前变更，给出可以执行的改进建议。\n\n## 审查顺序\n\n1. 先理解需求与验收标准，再阅读差异。\n2. 优先检查逻辑正确性、数据边界与异常路径。\n3. 核查是否影响现有行为，以及是否缺少必要测试。\n4. 对没有证据的判断，明确说明不确定性。\n\n## 输出格式\n\n- 问题：描述具体触发条件与影响。\n- 位置：提供文件路径和相关代码。\n- 建议：给出最小修改方案与验证方法。\n\n只报告值得修复的问题；没有发现问题时，说明已检查的范围。'
  await write(path.join(codex_home, 'instructions.md'), prompt)
  await write(path.join(codex_home, 'memories/memory_summary.md'), '# 开发协作记忆\n\n这是一份完全虚构的项目记忆，用于展示 Codex Manager。\n\n## 沟通偏好\n\n- 使用简体中文，先说明结论，再解释原因。\n- 需求有歧义时先确认，避免扩大修改范围。\n- 交付时附上验证结果与仍需关注的问题。\n\n## 当前项目：星光任务板\n\n一个帮助个人整理每日工作的示例应用。\n\n| 项目约定 | 内容 |\n| --- | --- |\n| 技术栈 | React + TypeScript |\n| 界面风格 | 简洁、清晰，支持明暗模式 |\n| 数据策略 | 本地存储，显式导出 |\n\n## 已确认的设计\n\n1. 任务支持待办、进行中、已完成三种状态。\n2. 搜索与筛选需要保留用户输入。\n3. 删除前确认，操作后提供明确反馈。\n\n## 下次继续\n\n完善键盘操作与空状态，补齐任务筛选的边界测试。')
  await write(path.join(codex_home, 'memories/MEMORY.md'), '# 项目开发约定\n\n所有条目均为演示数据。\n\n## 组件设计\n\n优先复用现有组件，保持输入、按钮和提示的一致性。')
  for (const [name, title] of [['task-board', '任务板交互设计'], ['theme-review', '明暗模式验收'], ['release-plan', '版本发布准备']]) {
    await write(path.join(codex_home, `memories/rollout_summaries/${name}.md`), `# ${title}\n\n演示任务总结。\n\n## 结论\n\n需求已拆分为可验证的小步骤，下一次从未完成的验收项继续。`)
  }
  for (const [name, description] of [['code-review', '检查变更、识别边界问题，给出可执行的审查建议'], ['ui-acceptance', '检查布局、键盘操作、空状态与错误反馈'], ['release-checklist', '核对版本、变更说明与发布前验证结果'], ['docs-writing', '将实现整理成清晰的中文使用文档']]) {
    await write(path.join(home, `.agents/skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: ${description}\n---\n# ${description}\n\n此技能仅为演示数据。\n\n## 执行步骤\n\n1. 阅读需求与相关文件。\n2. 按检查项逐一核对并记录依据。\n3. 输出结论、问题与下一步建议。`)
  }
  const sample_sessions = [
    ['task-board', '星光任务板', '设计任务板的筛选与空状态', '请为任务板设计筛选交互，支持按状态和优先级组合筛选，并说明没有结果时如何引导用户。', '## 交互方案\n\n筛选栏保留在列表上方，让当前条件始终可见。\n\n| 筛选项 | 可选值 |\n| --- | --- |\n| 状态 | 全部、待办、进行中、已完成 |\n| 优先级 | 全部、普通、重要、紧急 |\n\n### 无结果时\n\n显示“没有符合条件的任务”，保留筛选条件，并提供“清除筛选”按钮。\n\n### 验收要点\n\n- 切换条件后立即更新结果数量。\n- 空状态不会清除已输入的关键词。\n- 键盘可以依次访问所有筛选控件。'],
    ['keyboard', '星光任务板', '补齐键盘操作与焦点反馈', '为新增任务弹窗补齐键盘操作。', '打开弹窗时聚焦标题输入框；关闭后焦点返回触发按钮。'],
    ['storage', '星光任务板', '核查本地存储与导出格式', '检查任务导出的字段与兼容策略。', '使用版本字段标识格式；导出包含标题、状态、优先级与创建时间。'],
    ['landing', '灵感笔记', '整理产品首页的内容结构', '为灵感笔记整理首页文案。', '首页依次呈现产品价值、操作演示与开始使用入口。'],
    ['search', '灵感笔记', '增加笔记搜索与标签筛选', '说明如何组合搜索关键词与标签。', '关键词匹配标题及正文，标签用于缩小结果范围。'],
    ['release', '示例工具箱', '生成版本发布检查清单', '整理发布前必须完成的验证。', '检查版本号、构建产物、变更说明以及全新环境启动。'],
  ]
  const session_index = []
  for (const [index, [id, project, title, question, answer]] of sample_sessions.entries()) {
    const timestamp = `2026-09-20T0${9-index}:30:00Z`
    const rows = [
      { type: 'session_meta', timestamp, payload: { id, cwd: `D:/Demo/${project}` } },
      { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] } },
      { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] } },
    ]
    const session_path = path.join(codex_home, `sessions/2026/09/20/rollout-${id}.jsonl`)
    await write(session_path, rows.map(JSON.stringify).join('\n') + '\n')
    await fs.utimes(session_path, new Date(timestamp), new Date(timestamp))
    session_index.push({ id, thread_name: title, updated_at: timestamp })
  }
  await write(path.join(codex_home, 'session_index.jsonl'), session_index.map(JSON.stringify).join('\n') + '\n')
  await app.whenReady()
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }))
  const accounts = [['work', 'work@demo.example', 'pro', 18, 36], ['studio', 'studio@demo.example', 'plus', 42, 21], ['personal', 'personal@demo.example', 'plus', 65, 48], ['lab', 'lab@demo.example', 'pro', 9, 15]].map(([name, email, plan_type, used_short, used_week]) => ({
    id: createHash('sha256').update(`demo-${name}`).digest('hex').slice(0, 20), accountId: `demo-${name}`, email, planType: plan_type,
    accessToken: 'demo-access-not-a-real-token', refreshToken: 'demo-refresh-not-a-real-token', idToken: 'demo-id-not-a-real-token',
    expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-20T09:30:00Z',
    profile: { authProvider: 'google', organizationTitle: '演示工作空间' },
    usage: { fetchedAt: '2026-09-20T09:30:00Z', primary: { usedPercent: used_short, windowSeconds: 18000 }, secondary: { usedPercent: used_week, windowSeconds: 604800 } },
  }))
  await write(path.join(codex_home, 'auth.json'), JSON.stringify({ email: accounts[0].email, tokens: { account_id: accounts[0].accountId, access_token: accounts[0].accessToken, id_token: accounts[0].idToken, refresh_token: accounts[0].refreshToken } }))
  await write(path.join(user_data, 'accounts.vault'), safeStorage.encryptString(JSON.stringify({ accounts, settings: { autoRefresh: false, minimizeToTray: false, themeMode: 'light' }, prompt: { content: prompt, original: prompt, history: [] } })).toString('base64'))
  const errors = []
  const timeout = setTimeout(() => { console.error('README 截图生成超时'); app.exit(2) }, 120000)
  app.once('browser-window-created', (_event, win) => {
    // 仅替换连接状态，主题内容仍由实际资源和预览引擎渲染。
    ipcMain.removeHandler('skins:status')
    ipcMain.handle('skins:status', () => ({ success: true, data: { connected: false, backups: [], message: '演示环境 · 未连接 Codex', motion_enabled: false } }))
    win.webContents.setBackgroundThrottling(false)
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    win.webContents.once('did-finish-load', async () => {
      const run = code => win.webContents.executeJavaScript(code, true)
      const until = async code => {
        for (let attempt = 0; attempt < 150; attempt++) { if (await run(code)) return; await pause(60) }
        throw Error(`页面尚未就绪：${code}`)
      }
      const click = async (selector) => { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(150) }
      const nav = async label => { await click(`nav button[aria-label="${label}"]`); await pause(350) }
      const capture = async name => {
        await run('document.fonts.ready')
        await pause(350)
        await fs.writeFile(path.join(output_root, `${name}.png`), (await win.webContents.capturePage()).toPNG())
        console.log(`已生成：${name}.png`)
      }
      try {
        win.setContentSize(1440, 960)
        win.show()
        await until('document.querySelectorAll(".account").length === 4')
        await capture('accounts')
        await run('[...document.querySelectorAll(".page-head button")].find(button => button.textContent.trim() === "添加账号").click()')
        await until('!!document.querySelector("#account-json")')
        await run('[...document.querySelectorAll(".modal button")].find(button => button.textContent.trim() === "导入本机登录").click()')
        await until('!!document.querySelector(".account-import-preview")')
        await capture('account-import')
        await run('[...document.querySelectorAll(".modal button")].find(button => button.textContent.trim() === "取消").click()')
        await nav('会话管理')
        await until('document.querySelectorAll(".session-row").length === 6')
        await run('[...document.querySelectorAll(".session-row-main")].find(button => button.textContent.includes("设计任务板")).click()')
        await until('document.querySelector(".session-detail").textContent.includes("交互方案")')
        await capture('sessions')
        await run('[...document.querySelectorAll(".page-head button")].find(button => button.textContent.trim() === "导出").click()')
        await until('!!document.querySelector(".export-scope-grid")')
        await capture('session-export')
        await run('[...document.querySelectorAll(".modal button")].find(button => button.textContent.trim() === "取消").click()')
        await nav('记忆管理')
        await until('document.querySelector(".memory-body")?.textContent.includes("星光任务板")')
        await capture('memories')
        await nav('提示词')
        await until('!!document.querySelector(".prompt-editor textarea")')
        await capture('prompts')
        await nav('MCP / Skills')
        await until('document.querySelectorAll(".extension-row").length === 4')
        await capture('mcp')
        await click('.section-tabs button:nth-child(2)')
        await until('document.querySelector(".extension-list")?.textContent.includes("code-review")')
        await capture('skills')
        await nav('主题')
        await until('document.querySelectorAll(".original-card").length === 20')
        await until('[...document.querySelectorAll(".original-card-preview img")].slice(0,3).every(image => image.complete && image.naturalWidth > 0)')
        await capture('themes')
        await click('.original-card-preview')
        await until('!!document.querySelector(".original-preview-stage iframe")')
        await pause(800)
        await capture('theme-light')
        await click('.original-preview-options button[aria-label="深色预览"]')
        await pause(900)
        await capture('theme-dark')
        await click('[aria-label="关闭主题预览"]')
        await nav('应用设置')
        await run('[...document.querySelectorAll(".appearance-options button")].find(button => button.textContent.trim() === "深色").click()')
        await pause(350)
        await nav('账号管理')
        await until('document.querySelectorAll(".account").length === 4')
        await capture('accounts-dark')
        assert.deepEqual(errors, [], '页面不应出现控制台错误')
        clearTimeout(timeout)
        console.log('README 配图生成完成：12 张，全部使用合成数据。')
        app.exit(0)
      } catch (error) {
        console.error(error)
        console.error(await run('document.body.innerText').catch(() => '页面不可读取'))
        app.exit(1)
      }
    })
  })
  require(path.join(project_root, 'out/main/index.js'))
}

main().catch(error => { console.error(error); app.exit(1) })
