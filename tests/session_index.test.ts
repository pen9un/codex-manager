import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, toNamespacedPath } from 'node:path'
import { expect, it } from 'vitest'
import { createSessionService } from '../src/main/session_service'
import { parseSessionFile } from '../src/main/session_parser'

const row = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + '\n'
it('SQLite 扩展路径与扫描普通路径合并为一个文件且正文不重复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-path-alias-'))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-s.jsonl')
  await writeFile(path, row('session_meta', { id: 's' }) + row('response_item', { type: 'message', role: 'user', content: '唯一指令' }))
  const db = new DatabaseSync(join(root, 'state_5.sqlite'))
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT)')
  db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run('s', toNamespacedPath(path), '索引标题')
  db.close()
  const service = createSessionService({ env: { CODEX_HOME: root } })
  expect((await service.list()).sessions[0].fileCount).toBe(1)
  expect(await service.files('s')).toHaveLength(1)
  expect((await service.detail('s')).blocks).toHaveLength(1)
})
it('优先读取真实 SQLite 标题，显式无项目任务不会按工作目录误分组', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-index-'))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-s.jsonl')
  await writeFile(path, row('session_meta', { id: 's', cwd: 'D:/temporary' }) + row('response_item', { type: 'message', role: 'user', content: '用户原文' }))
  const db = new DatabaseSync(join(root, 'state_5.sqlite'))
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, cwd TEXT, created_at INTEGER, updated_at INTEGER, archived INTEGER, first_user_message TEXT)')
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s', path, '用户改过的标题', 'D:/temporary', 1789700000, 1789700100, 0, '用户原文')
  db.close()
  await writeFile(join(root, '.codex-global-state.json'), JSON.stringify({ 'projectless-thread-ids': ['s'] }))
  const service = createSessionService({ env: { CODEX_HOME: root } })
  const catalog = await service.list()
  expect(catalog.sessions[0].title).toBe('用户改过的标题')
  expect(catalog.sessions[0].projectPath).toBeUndefined()
  expect(catalog.projects[0].name).toBe('未归属项目')
  expect((await service.detail('s')).summary.projectPath).toBeUndefined()
  // 分叉会话可能携带父会话的历史元信息，路径对应的官方 ID 才是当前身份。
  await writeFile(path, row('session_meta', { id: 'parent', cwd: 'D:/parent' }) + row('response_item', { type: 'message', role: 'user', content: '分叉后的请求' }))
  const refreshed = await service.refresh()
  expect(refreshed.sessions.map(item => item.id)).toEqual(['s'])
  expect((await service.detail('s')).summary.id).toBe('s')
})

it('剥离注入前缀后仍保留同条消息后面的用户请求', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-injection-'))
  const path = join(root, 'rollout-s.jsonl')
  await writeFile(path, row('session_meta', { id: 's' }) + row('response_item', { type: 'message', role: 'user', content: '<recommended_plugins>注入列表</recommended_plugins>\n# AGENTS.md instructions for D:/demo\n<INSTRUCTIONS>规则</INSTRUCTIONS><environment_context>环境</environment_context>\n请检查加载速度' }))
  const detail = await parseSessionFile({ id: 's', path, archived: false })
  expect(detail.blocks.map(block => block.text)).toEqual(['请检查加载速度'])
  expect(detail.summary.title).toBe('请检查加载速度')
  expect(JSON.stringify(detail.rawRecords)).toContain('recommended_plugins')
})

it('列表只读文件头，完整正文诊断在打开详情时计算', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-header-'))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-s.jsonl')
  await writeFile(path, row('session_meta', { id: 's', cwd: 'D:/demo' }) + row('response_item', { type: 'message', role: 'user', content: '真正的问题' }))
  await appendFile(path, row('response_item', { type: 'function_call_output', output: 'x'.repeat(1024 * 1024) }) + '{破损行\n')
  const service = createSessionService({ env: { CODEX_HOME: root } })
  const catalog = await service.list()
  expect(catalog.sessions[0].title).toBe('真正的问题')
  expect(catalog.sessions[0].diagnostics.malformedLines).toBe(0)
  expect((await service.detail('s')).summary.diagnostics.malformedLines).toBe(1)
})

it('分页详情的块 ID、工具归属和文本与完整读取一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-pages-'))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-s.jsonl')
  let data = row('session_meta', { id: 's' })
  for (let i = 0; i < 120; i++) data += row('turn_context', { turn_id: `t${i}` }) + row('response_item', { type: 'message', role: 'user', content: `问题${i}` }) + row('response_item', { type: 'message', role: 'assistant', content: `回答${i}` })
  await writeFile(path, data.replaceAll('\n', '\r\n'))
  const service = createSessionService({ env: { CODEX_HOME: root } })
  let page = await service.detail('s')
  expect(page.blocks.length).toBeLessThan(240)
  const blocks = [...page.blocks]
  while (page.nextCursor) { page = await service.detail('s', undefined, page.nextCursor); blocks.push(...page.blocks) }
  const full = await service.detail('s', { includeRaw: false })
  expect(blocks).toEqual(full.blocks)
})

it('新版索引从 project_roots 获取项目路径而不是会话临时工作目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-project-roots-'))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-s.jsonl')
  await writeFile(path, row('session_meta', { id: 's', cwd: 'D:/worktree/tmp' }))
  const db = new DatabaseSync(join(root, 'state_6.sqlite'))
  db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, title TEXT, project_id TEXT); CREATE TABLE projects (id TEXT, name TEXT, metadata TEXT); CREATE TABLE project_roots (project_id TEXT, position INTEGER, path TEXT)")
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run('s', path, 'D:/worktree/tmp', '真实标题', 'p')
  db.exec(`INSERT INTO projects VALUES ('p', '我的项目', '{}'); INSERT INTO project_roots VALUES ('p', 0, 'D:/project')`)
  db.close()
  const catalog = await createSessionService({ env: { CODEX_HOME: root } }).list()
  expect(catalog.projects[0].name).toBe('我的项目')
  expect(catalog.sessions[0].projectPath).toBe('D:/project')
})
