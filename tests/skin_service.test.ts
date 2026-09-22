import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import * as service from '../src/main/themes'
import { create_original_catalog } from './theme_fixture'

const directories: string[] = []
async function fixture(options: { include_hero?: boolean; css?: string } = {}): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'original-skin-'))
  const root = join(base, 'skins')
  directories.push(base)
  await mkdir(root, { recursive: true })
  await cp(resolve('resources/theme-engine'), join(base, 'theme-engine'), { recursive: true })
  await create_original_catalog(root, options)
  return root
}
async function replace_config(root: string, mutate: (config: any) => void): Promise<void> {
  const config_path = join(root, 'moon-garden/theme.json')
  const config = JSON.parse(await readFile(config_path, 'utf8'))
  mutate(config)
  const config_bytes = Buffer.from(JSON.stringify(config))
  await writeFile(config_path, config_bytes)
  const catalog_path = join(root, 'catalog.json')
  const catalog = JSON.parse(await readFile(catalog_path, 'utf8'))
  catalog[0].hashes['theme.json'] = createHash('sha256').update(config_bytes).digest('hex')
  await writeFile(catalog_path, JSON.stringify(catalog))
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

async function replace_catalog(root: string, mutate: (entry: any) => void): Promise<void> {
  const catalog_path = join(root, 'catalog.json')
  const catalog = JSON.parse(await readFile(catalog_path, 'utf8'))
  mutate(catalog[0])
  await writeFile(catalog_path, JSON.stringify(catalog))
}

describe('主题来源与分类兼容', () => {
  it.each(['original', 'ip-recreation', 'user-characters'])('列表、详情及导出保留来源 %s', async content_kind => {
    const root = await fixture()
    const source = { content_kind, original: content_kind === 'original' }
    await replace_config(root, config => Object.assign(config.codexManager, source))
    await replace_catalog(root, entry => Object.assign(entry, source))
    expect((await service.list_skins(root))[0]).toMatchObject(source)
    expect(await service.load_skin('moon-garden', root)).toMatchObject(source)
    const files = unzipSync(await service.export_skin('moon-garden', root))
    expect(JSON.parse(Buffer.from(files['theme.json']).toString()).codexManager).toMatchObject(source)
    expect(Buffer.from(files['theme.json'])).toEqual(await readFile(join(root, 'moon-garden/theme.json')))
  })

  it('旧配置缺少来源字段时根据 original:true 解释为原创', async () => {
    const root = await fixture()
    expect((await service.list_skins(root))[0]).toMatchObject({ content_kind: 'original', original: true })
    expect(await service.load_skin('moon-garden', root)).toMatchObject({ content_kind: 'original', original: true })
  })

  it.each([
    { content_kind: 'unknown', original: true },
    { content_kind: 1, original: true },
    { content_kind: null, original: true },
    { content_kind: 'original', original: false },
    { content_kind: 'ip-recreation', original: true },
    { content_kind: 'user-characters', original: 'false' },
    { original: false },
  ])('拒绝配置和目录中的无效来源 $content_kind / $original', async source => {
    const config_root = await fixture()
    await replace_config(config_root, config => Object.assign(config.codexManager, source))
    await expect(service.list_skins(config_root)).rejects.toThrow('来源')
    const catalog_root = await fixture()
    await replace_catalog(catalog_root, entry => Object.assign(entry, source))
    await expect(service.list_skins(catalog_root)).rejects.toThrow('来源')
  })

  it('拒绝目录与配置之间的来源冲突', async () => {
    const root = await fixture()
    await replace_config(root, config => Object.assign(config.codexManager, { content_kind: 'ip-recreation', original: false }))
    await replace_catalog(root, entry => Object.assign(entry, { content_kind: 'user-characters', original: false }))
    await expect(service.list_skins(root)).rejects.toThrow('来源不一致')
    await expect(service.export_skin('moon-garden', root)).rejects.toThrow('来源不一致')
  })

  it.each([
    ['trending', 'trending'], ['anime', 'anime'], ['geek', 'geek'], ['cyber', 'cyber'],
    ['nature', 'nature'], ['companions', 'companions'], ['professional', 'geek'],
    ['fantasy', 'anime'], ['characters', 'anime'],
  ])('分类 %s 输出为 %s', async (input_category, output_category) => {
    const root = await fixture()
    await replace_config(root, config => { config.codexManager.category = input_category })
    expect((await service.list_skins(root))[0].category).toBe(output_category)
    expect((await service.load_skin('moon-garden', root)).category).toBe(output_category)
  })
})

describe('原创主题服务', () => {
  it('列表只校验配置与双缩略图，不读取大图', async () => {
    const root = await fixture({ include_hero: false })
    const skins = await service.list_skins(root)
    expect(skins).toHaveLength(1)
    expect(skins[0]).toMatchObject({
      id: 'moon-garden', name: '月下花园', category: 'nature', tags: ['自然', '月光', '安静'],
      modes: ['light', 'dark'], has_preview: true, package_extension: 'codextheme', motion: true, original: true,
    })
    expect(skins[0].thumbnails.light).toMatch(/^data:image\/webp;base64,/)
    expect(skins[0].thumbnail).toBe(skins[0].thumbnails.light)
    expect(skins[0]).not.toHaveProperty('repository')
  })

  it('加载双模式主图与配色，并在任一哈希损坏时停止', async () => {
    const root = await fixture()
    const skin = await service.load_skin('moon-garden', root)
    expect(skin.images.light).toMatch(/^data:image\/webp;base64,/)
    expect(skin.images.dark).not.toBe(skin.images.light)
    expect(skin.image).toBe(skin.images.light)
    expect(skin.palettes.dark.background).toBe('#111827')
    await writeFile(join(root, 'moon-garden/hero-dark.webp'), '损坏')
    await expect(service.load_skin('moon-garden', root)).rejects.toThrow('校验失败')
  })

  it('拒绝目录穿越、远程资源和未列入哈希的文件', async () => {
    const root = await fixture()
    await expect(service.load_skin('../auth.json', root)).rejects.toThrow('主题不存在')
    await replace_config(root, config => { config.codexManager.art.dark = 'https://example.com/dark.webp' })
    await expect(service.load_skin('moon-garden', root)).rejects.toThrow('资源路径无效')

    const clean_root = await fixture()
    await writeFile(join(clean_root, 'moon-garden/unlisted.txt'), '不应被忽略')
    await expect(service.export_skin('moon-garden', clean_root)).rejects.toThrow('未登记')
  })

  it('原创样式禁止任何 url 或 @import，同时允许直接使用主图变量', async () => {
    const escaped_url = await fixture({ css: String.raw`.preview { background: url(https\3a //example.invalid/review.png); }` })
    await expect(service.load_skin('moon-garden', escaped_url)).rejects.toThrow('不允许的外部资源')

    const protocol_relative = await fixture({ css: '.preview { background: url(//example.invalid/review.png); }' })
    await expect(service.load_skin('moon-garden', protocol_relative)).rejects.toThrow('不允许的外部资源')

    const imported = await fixture({ css: '@import "theme.css"; .preview { color: red; }' })
    await expect(service.load_skin('moon-garden', imported)).rejects.toThrow('不允许的外部资源')

    const variable = await fixture({ css: '.preview { background: var(--original-art); }' })
    await expect(service.load_skin('moon-garden', variable)).resolves.toMatchObject({ id: 'moon-garden' })
  })

  it('列表拒绝缺少标准字段或包含不安全颜色的非完整配置', async () => {
    const incomplete = await fixture()
    await replace_config(incomplete, config => { delete config.heroFit })
    await expect(service.list_skins(incomplete)).rejects.toThrow('配置无效')

    const unsafe = await fixture()
    await replace_config(unsafe, config => { config.light.background = 'url(file:///secret)' })
    await expect(service.list_skins(unsafe)).rejects.toThrow('配色无效')
  })

  it('导出完整原创主题包并逐字节保留全部登记文件', async () => {
    const root = await fixture()
    const files = unzipSync(await service.export_skin('moon-garden', root))
    expect(Object.keys(files).sort()).toEqual([
      'LICENSE.txt', 'NOTICE.txt', 'hero-dark.webp', 'hero-light.webp', 'original.css',
      'preview-dark.webp', 'preview-light.webp', 'provenance.json', 'theme.json',
    ])
    expect(Buffer.from(files['hero-dark.webp'])).toEqual(await readFile(join(root, 'moon-garden/hero-dark.webp')))
    expect(Buffer.from(files['NOTICE.txt']).toString()).toContain('第三方工具可能缺少扩展效果')
  })

  it('隔离预览复用真实注入包，并切换双模式与首页/任务场景', async () => {
    const root = await fixture()
    const home = await service.render_skin_preview('moon-garden', 'dark', 'home', true, root)
    expect(home).toContain("default-src 'none'")
    expect(home).toContain('data-dream-shell')
    const html_root = home.match(/<html[^>]*>/)?.[0]
    expect(html_root).toContain('data-theme="dark"')
    expect(html_root).not.toContain('data-dream-theme')
    expect(home).toContain('setAttribute("data-dream-theme"')
    expect(home).toContain((await service.load_skin('moon-garden', root)).images.dark)
    expect(home).toContain('data-preview-view="home"')
    expect(home).not.toContain('https://')
    const task = await service.render_skin_preview('moon-garden', 'light', 'task', false, root)
    expect(task).toContain('data-preview-view="task"')
    expect(task).toContain('class="diff"')
    expect(task).toContain('let motionEnabled = false')
  })
})
