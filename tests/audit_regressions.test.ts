import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '@iarna/toml'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '../src/renderer/src/MarkdownView'
import { read_local_prompt } from '../src/main/localPrompt'

const fixture = vi.hoisted(() => ({ path: '' }))
vi.mock('../src/main/codex', () => ({ configPath: () => fixture.path }))
import { rollbackMcpBackup } from '../src/main/mcp'

const temp_roots: string[] = []
async function fixture_root(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cam-audit-'))
  temp_roots.push(root)
  return root
}
afterEach(async () => { for (const root of temp_roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('审计发现回归', () => {
  it('不把未启用 profile 的指令当作当前提示词', async () => {
    const root = await fixture_root()
    await writeFile(join(root, 'config.toml'), '[profiles.unused]\nmodel_instructions_file = "unused.md"\n')
    await writeFile(join(root, 'unused.md'), '错误的配置')
    expect((await read_local_prompt(root, '草稿')).content).not.toContain('错误的配置')
  })
  it('不根据文件名把未配置的 prompts/default.md 当作当前指令', async () => {
    const root = await fixture_root()
    await mkdir(join(root, 'prompts'))
    await writeFile(join(root, 'prompts/default.md'), '未激活的模板')
    expect((await read_local_prompt(root, '草稿')).content).not.toContain('未激活的模板')
  })
  it('全局指令优先读取 AGENTS.override.md', async () => {
    const root = await fixture_root()
    await writeFile(join(root, 'AGENTS.md'), '普通规则')
    await writeFile(join(root, 'AGENTS.override.md'), '覆盖规则')
    const local = await read_local_prompt(root, '草稿')
    expect(local.content).toContain('覆盖规则')
    expect(local.content).not.toContain('普通规则')
  })
  it('配置指令文件缺失时明确报告读取失败', async () => {
    const root = await fixture_root()
    await writeFile(join(root, 'config.toml'), 'model_instructions_file = "missing.md"\n')
    expect((await read_local_prompt(root, '草稿')).source_warning).toContain('读取失败')
  })
  it('MCP 回滚只恢复 MCP，保留当前模型等配置并备份', async () => {
    const root = await fixture_root()
    fixture.path = join(root, 'config.toml')
    const before = 'model = "current-model"\n[mcp_servers.new]\ncommand = "node"\n'
    await writeFile(fixture.path, before)
    await writeFile(join(root, 'config.toml.bak-mcp-old'), 'model = "old-model"\n[mcp_servers.old]\ncommand = "python"\n')
    await rollbackMcpBackup('config.toml.bak-mcp-old')
    const result = parse(await readFile(fixture.path, 'utf8'))
    expect(result.model).toBe('current-model')
    expect(result.mcp_servers).toEqual({ old: { command: 'python' } })
    const backups = (await readdir(root)).filter(name => name.startsWith('config.toml.bak-rollback-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(root, backups[0]), 'utf8')).toBe(before)
  })
  it('无效 MCP 备份不能覆盖正常配置', async () => {
    const root = await fixture_root()
    fixture.path = join(root, 'config.toml')
    await writeFile(fixture.path, 'model = "valid"\n')
    await writeFile(join(root, 'config.toml.bak-mcp-broken'), '[[[broken')
    await expect(rollbackMcpBackup('config.toml.bak-mcp-broken')).rejects.toThrow()
    expect(await readFile(fixture.path, 'utf8')).toBe('model = "valid"\n')
  })
  it('渲染紧邻段落的表格、转义管道符和任务列表', () => {
    const source = '说明\n| 字段 | 内容 |\n| --- | --- |\n| 命令 | `a\\|b` |\n\n- [x] 已完成\n- [ ] 待处理\n\n~~删除~~'
    const html = renderToStaticMarkup(createElement(MarkdownView, { source }))
    expect(html).toContain('<table>')
    expect(html).toContain('<code>a|b</code>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<del>删除</del>')
  })
})
