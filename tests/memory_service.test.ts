import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_memory_service } from '../src/main/memory_service'
import { validate_memory_path, read_memory_page } from '../src/main/memory_files'

let fixture_root: string
let memory_root: string
beforeEach(async () => {
  fixture_root = await mkdtemp(join(tmpdir(), 'memory-service-'))
  memory_root = join(fixture_root, 'memories')
  await mkdir(memory_root)
})
afterEach(async () => { await rm(fixture_root, { recursive: true, force: true }) })
async function add_file(relative_path: string, content: string | Buffer) {
  const file = join(memory_root, relative_path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content)
  return file
}

describe('记忆目录与只读服务', () => {
  it('按相对路径分类并跳过二进制、临时及链接文件', async () => {
    await add_file('memory_summary.md', '# 摘要\n摘要内容')
    await add_file('MEMORY.md', '# 长期')
    await add_file('raw_memories.md', '# 原始')
    await add_file('rollout_summaries/session.md', '# 会话')
    await add_file('skills/demo/SKILL.md', '# 技能')
    await add_file('extensions/ad_hoc/notes/note.md', '# 笔记')
    await add_file('misc/info.json', '{"说明":"只列元数据"}')
    await add_file('bad.png', Buffer.from([0, 1, 2]))
    await add_file('unknown.dat', Buffer.from([0xff, 0xfe, 0xfd]))
    await add_file('draft.md.tmp', '草稿')
    await add_file('.git/hidden.md', '忽略')
    const catalog = await create_memory_service({ codex_home: fixture_root }).list()
    expect(catalog.files).toHaveLength(7)
    expect(catalog.files.map(file => file.category).sort()).toEqual(['long_term', 'notes', 'other', 'raw', 'rollouts', 'skills', 'summary'])
    expect(catalog.files.find(file => file.category === 'summary')?.title).toBe('摘要')
    expect(catalog.files.find(file => file.relative_path.endsWith('.json'))?.readable).toBe(false)
    expect(catalog.files.every(file => /^[a-f0-9]{64}$/.test(file.id))).toBe(true)
  })

  it('搜索摘要以外的全文内容并保留文件消失错误', async () => {
    const file = await add_file('deep.md', `# 内容\n${'普通'.repeat(12000)}隐藏查询词`)
    const service = create_memory_service({ codex_home: fixture_root })
    await service.list()
    expect((await service.search('隐藏查询词')).files).toHaveLength(1)
    expect((await service.search('隐藏查询词', 'skills')).files).toHaveLength(0)
    await rm(file)
    expect((await service.search('隐藏查询词')).warnings).toHaveLength(1)
  })

  it('小文件保留BOM与换行信息并拒绝未知id', async () => {
    await add_file('note.md', '\ufeff# 中文\r\n内容\r\n')
    const service = create_memory_service({ codex_home: fixture_root })
    const entry = (await service.list()).files[0]
    const document = await service.read(entry.id)
    expect(document).toMatchObject({ content: '# 中文\r\n内容\r\n', editable: true, has_bom: true, newline: 'crlf', offset: 0 })
    expect(document.version).toMatch(/^[a-f0-9]{64}$/)
    await expect(service.resolve_file('../config.toml')).rejects.toThrow()
  })

  it('大文件分页不破坏UTF8字符且禁止跨版本继续读取', async () => {
    const content = '中😀文'.repeat(300000)
    const file = await add_file('large.md', content)
    const service = create_memory_service({ codex_home: fixture_root })
    const entry = (await service.list()).files[0]
    const first = await service.read(entry.id)
    expect(first.editable).toBe(false)
    expect(first.next_offset).toBeGreaterThan(0)
    const second = await service.read(entry.id, first.next_offset, first.version)
    expect(content.startsWith(first.content + second.content)).toBe(true)
    expect(first.content).not.toContain('\ufffd')
    await writeFile(file, `${content}变更`)
    await expect(service.read(entry.id, first.next_offset, first.version)).rejects.toThrow(/变更|版本/)
  })

  it('非法UTF8拒绝读取并使搜索显式报告失败', async () => {
    await add_file('damaged.md', Buffer.from([0x61, 0xc3, 0x28]))
    const service = create_memory_service({ codex_home: fixture_root })
    const entry = (await service.list()).files[0]
    expect(entry.readable).toBe(false)
    expect(entry.read_error).toBeTruthy()
    await expect(service.read(entry.id)).rejects.toThrow()
    expect((await service.search('a')).warnings).toHaveLength(1)
  })

  it('配置仅显示记忆布尔值且区分未设置和解析错误', async () => {
    await writeFile(join(fixture_root, 'config.toml'), '[memories]\ngenerate_memories=false\nuse_memories=true\nsecret="不应返回"\n[features]\nmemories=true\nother=true\n')
    const service = create_memory_service({ codex_home: fixture_root })
    const config = (await service.list()).config
    expect(config.values).toEqual(expect.arrayContaining([{ key: 'memories.generate_memories', value: false }, { key: 'memories.use_memories', value: true }, { key: 'features.memories', value: true }]))
    expect(JSON.stringify(config)).not.toContain('secret')
    await writeFile(join(fixture_root, 'config.toml'), '[memories')
    expect((await service.refresh()).config.error).toBeTruthy()
    await rm(join(fixture_root, 'config.toml'))
    expect((await service.refresh()).config.values.every(value => value.value === null)).toBe(true)
  })

  it('不存在的目录不创建任何真实记忆目录', async () => {
    await rm(memory_root, { recursive: true })
    const catalog = await create_memory_service({ codex_home: fixture_root }).list()
    expect(catalog.exists).toBe(false)
    expect(catalog.files).toEqual([])
  })

  it('隐藏的正常Markdown仍被索引且刷新后加入新文件', async () => {
    const service = create_memory_service({ codex_home: fixture_root })
    expect((await service.list()).files).toHaveLength(0)
    await add_file('.personal.md', '# 个人记录')
    expect((await service.refresh()).files).toHaveLength(1)
  })

  it('摘要之后的损坏UTF8不能编辑且全文搜索不返回伪成功', async () => {
    await add_file('late_damage.md', Buffer.concat([Buffer.from('正常'.repeat(10000)), Buffer.from([0xc3, 0x28])]))
    const service = create_memory_service({ codex_home: fixture_root })
    const entry = (await service.list()).files[0]
    await expect(service.read(entry.id)).rejects.toThrow(/UTF-8/)
    const result = await service.search('正常')
    expect(result.files).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })

  it('配置只允许固定布尔字段且不传递其他布尔值', async () => {
    await writeFile(join(fixture_root, 'config.toml'), '[memories]\ndisable_on_external_context=true\nno_memories_if_mcp_or_web_search=false\nunknown_switch=true\n')
    const config = (await create_memory_service({ codex_home: fixture_root }).list()).config
    expect(config.values).toContainEqual({ key: 'memories.disable_on_external_context', value: true })
    expect(config.values).toContainEqual({ key: 'memories.no_memories_if_mcp_or_web_search', value: false })
    expect(JSON.stringify(config)).not.toContain('unknown_switch')
  })

  it('配置解析错误不泄露无关配置行的内容', async () => {
    await writeFile(join(fixture_root, 'config.toml'), 'api_key = "私密配置不可回传" extra')
    const config = (await create_memory_service({ codex_home: fixture_root }).list()).config
    expect(config.error).toBeTruthy()
    expect(JSON.stringify(config)).not.toContain('私密配置不可回传')
  })

  it('刷新按修改时间降序且同时间按路径排序', async () => {
    for (const [name, timestamp] of [['a.md', 100], ['z.md', 300], ['b.md', 200], ['c.md', 200]] as const) {
      const file = await add_file(name, '# 记录')
      await utimes(file, timestamp, timestamp)
    }
    const catalog = await create_memory_service({ codex_home: fixture_root }).refresh()
    expect(catalog.files.map(file => file.relative_path)).toEqual(['z.md', 'b.md', 'c.md', 'a.md'])
  })

  it('标题路径和仅元数据文件参与搜索', async () => {
    await add_file('folder/UniquePath.md', '# 独有标题\n普通正文')
    await add_file('metadata/OnlyMetadata.json', '{"不可全文搜索":"隐藏词"}')
    const service = create_memory_service({ codex_home: fixture_root })
    expect((await service.search('独有标题')).files).toHaveLength(1)
    expect((await service.search('uniquepath')).files).toHaveLength(1)
    const metadata_result = await service.search('onlymetadata')
    expect(metadata_result.files).toHaveLength(1)
    expect(metadata_result.files[0].readable).toBe(false)
    expect(metadata_result.files[0].excerpt).toContain('OnlyMetadata')
    expect((await service.search('隐藏词')).files).toEqual([])
  })

  it('正文搜索返回命中上下文保留原文大小写且支持跨流块命中', async () => {
    await add_file('deep.md', `${'A'.repeat(65532)}Before MatchToken AfterContext${'B'.repeat(100000)}`)
    const service = create_memory_service({ codex_home: fixture_root })
    const result = await service.search('before matchtoken')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].excerpt).toContain('Before MatchToken AfterContext')
    expect(result.files[0].excerpt.length).toBeLessThan(300)
    expect((await service.list()).files[0].excerpt).not.toContain('MatchToken')
  })

  it('搜索和读取拒绝非法参数并返回中文参数错误', async () => {
    const service = create_memory_service({ codex_home: fixture_root })
    for (const query of [null, 12, {}, '超'.repeat(501)]) {
      await expect(service.search(query as string)).rejects.toThrow(/参数/)
    }
    for (const category of [null, 12, {}, '__proto__', '无效分类']) {
      await expect(service.search('词', category as 'all')).rejects.toThrow(/参数/)
    }
    for (const id of [null, 12, {}, '']) {
      await expect(service.read(id as string)).rejects.toThrow(/参数/)
      await expect(service.resolve_file(id as string)).rejects.toThrow(/参数/)
    }
  })
})

describe('安全路径与字节分页', () => {
  it('拒绝路径穿越、绝对路径及ADS并允许合法待创建路径', async () => {
    for (const relative_path of ['../config.toml', 'notes/../file.md', 'C:\\file.md', '/file.md', 'file.md:secret']) {
      await expect(validate_memory_path(memory_root, relative_path, true)).rejects.toThrow()
    }
    expect(await validate_memory_path(memory_root, 'notes/new.md', true)).toBe(join(memory_root, 'notes/new.md'))
  })

  it('拒绝目录junction及目录根被替换的链接', async () => {
    const outside = join(fixture_root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'external.md'), '外部')
    await symlink(outside, join(memory_root, 'linked'), 'junction')
    await expect(validate_memory_path(memory_root, 'linked/external.md')).rejects.toThrow()
    expect((await create_memory_service({ codex_home: fixture_root }).list()).files).toEqual([])
  })

  it('非法分页位置和非UTF8边界不返回乱码', async () => {
    const file = await add_file('large.md', '中'.repeat(800000))
    await expect(read_memory_page(file, -1)).rejects.toThrow()
    await expect(read_memory_page(file, 1)).rejects.toThrow()
  })

  it('完整小文件的换行信息不受首行过长影响', async () => {
    const file = await add_file('long_line.md', `${'长'.repeat(9000)}\r\n结尾\r\n`)
    expect((await read_memory_page(file)).newline).toBe('crlf')
  })

  it('逐页重组严格等于原文且末页没有后续偏移', async () => {
    const content = '中文😀\r\n'.repeat(220000)
    const file = await add_file('pages.md', `\ufeff${content}`)
    let offset = 0
    let combined = ''
    while (true) {
      const page = await read_memory_page(file, offset)
      combined += page.content
      expect(page.has_bom).toBe(true)
      if (page.next_offset === undefined) break
      expect(page.next_offset).toBeGreaterThan(offset)
      offset = page.next_offset
    }
    expect(combined).toBe(content)
  })

  it('待创建的根目录不能通过祖先junction写入外部目录', async () => {
    const outside = join(fixture_root, 'outside')
    await mkdir(outside)
    const linked = join(fixture_root, 'linked')
    await symlink(outside, linked, 'junction')
    await expect(validate_memory_path(join(linked, 'missing'), 'notes/new.md', true)).rejects.toThrow(/链接|联接/)
  })
})
