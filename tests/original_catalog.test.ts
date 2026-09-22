import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { export_skin, list_skins, load_skin, render_skin_preview } from '../src/main/themes'

const expected_ids = [
  'fruit-base', 'lulu-duo', 'chiikawa-camp', 'labubu-forest', 'totoro-stop',
  'sea-train', 'cloud-castle', 'pixel-studio', 'crystal-core', 'zero-day',
  'neon-rider', 'pine-retreat', 'tidal-letter', 'ink-landscape',
  'orbital-harbor', 'neon-rain', 'floating-courier', 'cloud-cottage',
  'skyward-journal', 'moonlit-serenade',
]

describe('第二版最终主题资源全集', () => {
  it('目录中的每个主题均可加载、双模式渲染和完整导出', async () => {
    const root = resolve('resources/skins')
    const catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'))
    const skins = await list_skins(root)
    expect(catalog.map((item: { id: string }) => item.id)).toEqual(expected_ids)
    expect(skins.map(item => item.id)).toEqual(expected_ids)
    expect(skins).toHaveLength(20)
    expect(skins.filter(skin => skin.motion)).toHaveLength(14)

    for (const skin of skins) {
      const preview = await load_skin(skin.id, root)
      expect(preview.images.light).not.toBe(preview.images.dark)
      expect(preview.palettes.light.background).not.toBe(preview.palettes.dark.background)
      const light_html = await render_skin_preview(skin.id, 'light', 'home', true, root)
      const dark_html = await render_skin_preview(skin.id, 'dark', 'task', false, root)
      expect(light_html).toContain(preview.images.light)
      expect(light_html).toContain('const forcedMode = "light"')
      expect(dark_html).toContain(preview.images.dark)
      expect(dark_html).toContain('const forcedMode = "dark"')
      expect(dark_html).toContain(preview.palettes.dark.background)
      expect(dark_html).toContain('font-family')
      const exported = unzipSync(await export_skin(skin.id, root))
      const entry = catalog.find((item: { id: string }) => item.id === skin.id)
      expect(Object.keys(exported).sort()).toEqual(Object.keys(entry.hashes).sort())
    }
  })
})
