import { describe, expect, it } from 'vitest'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { export_skin } from '../src/main/themes'

const expected_ids = [
  'fruit-base', 'lulu-duo', 'chiikawa-camp', 'labubu-forest', 'totoro-stop',
  'sea-train', 'cloud-castle', 'pixel-studio', 'crystal-core', 'zero-day',
  'neon-rider', 'pine-retreat', 'tidal-letter', 'ink-landscape',
  'orbital-harbor', 'neon-rain', 'floating-courier', 'cloud-cottage',
  'skyward-journal', 'moonlit-serenade',
]
const ip_recreation_ids = new Set([
  'lulu-duo', 'chiikawa-camp', 'labubu-forest', 'totoro-stop', 'sea-train', 'cloud-castle',
])

const luminance = (hex: string): number => {
  const values = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
}
const contrast = (first: string, second: string): number => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

describe('主题馆第二版素材与配色验收', () => {
  it('20组最终主题导出后逐文件保持完整，包含双图、样式及说明', async () => {
    const root = resolve('resources/skins')
    const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'))
    for (const item of catalog) {
      const files = unzipSync(await export_skin(item.id, root))
      expect(Object.keys(files).sort()).toEqual(Object.keys(item.hashes).sort())
      for (const [name, hash] of Object.entries(item.hashes)) {
        expect(createHash('sha256').update(files[name]).digest('hex'), `${item.id}/${name}`).toBe(hash)
      }
    }
  }, 30000)

  it('仅包含指定顺序的20组最终主题、40张独立主图和同引擎缩略图，来源标记真实且文件满足体积约束', async () => {
    const root = resolve('resources/skins')
    const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'))
    const directories = (await readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort()
    expect(catalog.map((item: { id: string }) => item.id)).toEqual(expected_ids)
    expect(directories).toEqual([...expected_ids].sort())
    expect(directories).toHaveLength(20)
    const artworks = new Set<string>()
    for (const id of directories) {
      const config = JSON.parse(await readFile(join(root, id, 'theme.json'), 'utf8'))
      const provenance = JSON.parse(await readFile(join(root, id, 'provenance.json'), 'utf8'))
      const expected_kind = id === 'fruit-base' ? 'user-characters' : ip_recreation_ids.has(id) ? 'ip-recreation' : 'original'
      const entry = catalog.find((item: { id: string }) => item.id === id)
      expect(entry.content_kind, `${id}/目录来源`).toBe(expected_kind)
      expect(config.codexManager.content_kind, `${id}/配置来源`).toBe(expected_kind)
      expect(entry.original, `${id}/目录原创标记`).toBe(expected_kind === 'original')
      expect(config.codexManager.original, `${id}/配置原创标记`).toBe(expected_kind === 'original')
      for (const mode of ['light', 'dark']) {
        const hero = await readFile(join(root, id, config.codexManager.art[mode]))
        artworks.add(createHash('sha256').update(hero).digest('hex'))
        expect(hero.length).toBeLessThanOrEqual(2 * 1024 * 1024)
        expect((await stat(join(root, id, config.codexManager.thumbnails[mode]))).size).toBeLessThanOrEqual(160 * 1024)
        expect(provenance.assets[mode].preview.method).toBe('同引擎隔离 Electron 实际渲染')
        expect(provenance.assets[mode].prompt.length).toBeGreaterThan(60)
      }
    }
    expect(artworks.size).toBe(40)
  })

  it('实色阅读底、控件边界及选中态达到各自对比度门槛', async () => {
    const root = resolve('resources/skins')
    const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'))
    for (const { id } of catalog) {
      const config = JSON.parse(await readFile(join(root, id, 'theme.json'), 'utf8'))
      for (const mode of ['light', 'dark']) {
        const palette = config[mode]
        for (const background of ['background', 'panel', 'panelAlt', 'surface']) {
          for (const text of ['text', 'muted']) expect(contrast(palette[text], palette[background]), `${id}/${mode}/${text}/${background}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(palette.border, palette[background]), `${id}/${mode}/控件边界/${background}`).toBeGreaterThanOrEqual(3)
        }
        expect(contrast(palette.accent, palette.background), `${id}/${mode}/选中态`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
