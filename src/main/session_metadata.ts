import { DatabaseSync } from 'node:sqlite'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clean_user_text } from './session_parser'

export interface SessionMetadata {
  id: string; path?: string; title?: string; preview?: string; cwd?: string
  projectPath?: string; projectName?: string; projectless?: boolean
  created?: string; updated?: string; archived?: boolean
}

// 数据库只读打开，不复制主文件，保留对 WAL 最新事务的可见性。
export async function read_session_metadata(root: string): Promise<{ threads: Map<string, SessionMetadata>; warnings: string[] }> {
  const threads = new Map<string, SessionMetadata>()
  const warnings: string[] = []
  let state: Record<string, any> = {}
  try { state = JSON.parse(await readFile(join(root, '.codex-global-state.json'), 'utf8')) } catch { /* CLI 用户可能没有桌面状态。 */ }
  const names = (await readdir(root).catch(() => [] as string[])).filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]))
  for (const name of names) {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(join(root, name), { readOnly: true })
      const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>).map(item => item.name))
      if (!columns.has('id') || !columns.has('rollout_path')) continue
      const wanted = ['id', 'rollout_path', 'title', 'name', 'cwd', 'first_user_message', 'created_at', 'updated_at', 'archived', 'project_id'].filter(column => columns.has(column))
      const projects = new Map<string, any>()
      try { for (const project of db.prepare('SELECT id, name, metadata FROM projects').all() as any[]) projects.set(project.id, { ...project, metadata: JSON.parse(project.metadata) }) } catch { /* 旧数据库没有项目表。 */ }
      const roots = new Map<string, string>()
      try { for (const root of db.prepare('SELECT project_id, path FROM project_roots ORDER BY position').all() as any[]) if (!roots.has(root.project_id)) roots.set(root.project_id, root.path) } catch { /* 旧数据库可能把路径放在项目 metadata 中。 */ }
      for (const row of db.prepare(`SELECT ${wanted.join(', ')} FROM threads`).all() as any[]) {
        const project = projects.get(row.project_id)
        threads.set(row.id, {
          id: row.id, path: row.rollout_path, cwd: row.cwd,
          title: clean_user_text(row.name || row.title || '').split(/\r?\n/)[0].slice(0, 160) || undefined,
          preview: clean_user_text(row.first_user_message || '').replace(/\s+/g, ' ').slice(0, 180),
          created: row.created_at ? new Date(row.created_at * 1000).toISOString() : undefined,
          updated: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : undefined,
          archived: Boolean(row.archived), projectName: project?.name,
          projectPath: roots.get(row.project_id) || project?.metadata?.rootPaths?.[0] || project?.metadata?.path,
        })
      }
      break
    } catch { warnings.push('Codex 会话索引暂不可读，已回退到有限文件头扫描。') }
    finally { db?.close() }
  }
  const projectless = new Set<string>(state['projectless-thread-ids'] || [])
  const assignments = state['thread-project-assignments'] || {}
  const projects = state['local-projects'] || {}
  for (const id of new Set([...threads.keys(), ...projectless, ...Object.keys(assignments)])) {
    const item = threads.get(id) || { id }
    const project = projects[assignments[id]?.projectId]
    if (projectless.has(id)) { item.projectless = true; item.projectPath = undefined; item.projectName = undefined }
    else if (project) { item.projectPath = project.rootPaths?.[0]; item.projectName = project.name }
    threads.set(id, item)
  }
  return { threads, warnings }
}
