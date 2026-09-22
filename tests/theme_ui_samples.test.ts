import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { export_skin, list_skins, render_skin_preview } from '../src/main/themes'

const root = resolve('resources/skins')
const samples = ['fruit-base', 'lulu-duo', 'chiikawa-camp', 'labubu-forest', 'totoro-stop', 'sea-train', 'cloud-castle', 'pixel-studio', 'crystal-core', 'zero-day', 'neon-rider', 'pine-retreat', 'tidal-letter', 'ink-landscape', 'orbital-harbor', 'neon-rain', 'floating-courier', 'cloud-cottage', 'skyward-journal', 'moonlit-serenade']

describe('完整界面二十组主题契约', () => {
  it('全部主题接入完整组件，保留二十组目录及原画', async () => {
    const skins = await list_skins(root)
    expect(skins).toHaveLength(20)
    expect(skins.filter(skin => skin.ui_revision === 1).map(skin => skin.id).sort()).toEqual([...samples].sort())
    expect(skins.filter(skin => samples.includes(skin.id)).every(skin => skin.version === '1.1.0')).toBe(true)
  })

  it('设置和组件预览经过服务入口生成，包含真实可操作的示例状态', async () => {
    for (const id of samples) for (const mode of ['light', 'dark'] as const) {
      const settings = await render_skin_preview(id, mode, 'settings', false, root)
      expect(settings).toContain('data-preview-view="settings"')
      expect(settings).toContain('role="switch"')
      const components = await render_skin_preview(id, mode, 'components', false, root)
      expect(components).toContain('role="menu"')
      expect(components).toContain('role="dialog"')
      expect(components).toContain('aria-invalid="true"')
      expect(components).not.toContain('.preview-nav button:first-child')
      expect(components).toContain("default-src 'none'")
    }
  })

  it('导出包含完整组件样式和来源说明，运行素材沿用现有主图', async () => {
    for (const id of samples) {
      const files = unzipSync(await export_skin(id, root))
      const config = JSON.parse(Buffer.from(files['theme.json']).toString())
      expect(config.codexManager.ui_revision).toBe(1)
      const style = Buffer.from(files['original.css']).toString()
      for (const part of ['titlebar', 'conversation', 'composer', 'dialog', 'menu', 'settings', 'right-panel']) {
        expect(style).toContain(`data-cm-theme-part~="${part}"`)
      }
      expect(style).not.toMatch(/@import\b|url\s*\(/i)
      expect(Buffer.from(files['hero-light.webp'])).toEqual(await readFile(resolve(root, id, 'hero-light.webp')))
    }
  }, 20000)

  it('非法视图仍被拒绝，旧主题首页可继续读取', async () => {
    await expect(render_skin_preview(samples[0], 'light', 'unknown' as 'home', false, root)).rejects.toThrow('预览参数无效')
    expect(await render_skin_preview('pine-retreat', 'dark', 'home', false, root)).toContain('data-preview-view="home"')
  })
})
