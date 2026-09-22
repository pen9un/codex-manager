import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const image_bytes = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQ/eKXv/+BiOh/AAA=', 'base64')
const dark_image_bytes = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQjEb0pP+BiOh/AAA=', 'base64')

const palette = (dark: boolean) => ({
  background: dark ? '#111827' : '#f8fafc', panel: dark ? '#1f2937' : '#ffffff',
  panelAlt: dark ? '#273449' : '#eef2f7', surface: dark ? '#243044' : '#ffffff',
  text: dark ? '#f9fafb' : '#172033', muted: dark ? '#aeb8c8' : '#667085',
  border: dark ? '#44506a' : '#d7dee9', accent: '#4f7cff', accentAlt: '#7ea0ff',
  secondary: '#77b8a5', highlight: '#d69b4c',
})

export function original_theme(id = 'moon-garden') {
  return {
    schemaVersion: 2, uuid: `original-${id}`, id, version: '1.0.0', minEngineVersion: '2.0.0',
    name: '月下花园', description: '安静的中文自然主题', tagline: '让思路在月光里舒展', tags: ['自然', '月光', '安静'],
    hero: 'hero-light.webp', preview: 'preview-light.webp', light: palette(false), dark: palette(true),
    layout: 'dream-banner', heroFit: 'cover', heroFocusX: 0.5, heroFocusY: 0.4, heroZoom: 1,
    heroHeight: 360, heroTextAlign: 'left', heroScrim: 0.12, wallpaperEnabled: false,
    wallpaperFocusX: 0.5, wallpaperFocusY: 0.5, wallpaperOpacity: 0, wallpaperBlur: 0,
    radius: 'lg', density: 'normal', fontPreset: 'system', glass: true, shadow: 'md', decoration: 0.4,
    effects: { particles: 0, aurora: 0, glow: 0.2, noise: 0, grid: 0, float: 0 },
    brandSubtitle: 'MOON GARDEN', projectPrefix: '月下 · ', projectLabel: '选择任务', statusText: '专注中', quote: '慢一点也没有关系',
    codexManager: {
      category: 'nature', art: { light: 'hero-light.webp', dark: 'hero-dark.webp' },
      thumbnails: { light: 'preview-light.webp', dark: 'preview-dark.webp' },
      style: 'original.css', motion: 'moonlight', original: true,
    },
  }
}

const hash = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex')

export async function create_original_skin(root: string, options: { id?: string; include_hero?: boolean; css?: string } = {}): Promise<string> {
  const id = options.id || 'moon-garden'
  const directory = join(root, id)
  await mkdir(directory, { recursive: true })
  const config = original_theme(id)
  const files: Record<string, Buffer> = {
    'theme.json': Buffer.from(`${JSON.stringify(config, null, 2)}\n`),
    'preview-light.webp': image_bytes,
    'preview-dark.webp': dark_image_bytes,
    'original.css': Buffer.from(options.css || '[data-dream-theme="moon-garden"] { --original-accent: #4f7cff; }\n'),
    'provenance.json': Buffer.from('{"creator":"Codex-Manager"}\n'),
    'LICENSE.txt': Buffer.from('原创主题测试许可证\n'),
    'NOTICE.txt': Buffer.from('仅支持基础字段的第三方工具可能缺少扩展效果。\n'),
  }
  const light_hero = image_bytes
  const dark_hero = dark_image_bytes
  if (options.include_hero !== false) {
    files['hero-light.webp'] = light_hero
    files['hero-dark.webp'] = dark_hero
  }
  for (const [name, value] of Object.entries(files)) await writeFile(join(directory, name), value)
  const hashes: Record<string, string> = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)]))
  if (options.include_hero === false) {
    hashes['hero-light.webp'] = hash(light_hero)
    hashes['hero-dark.webp'] = hash(dark_hero)
  }
  return JSON.stringify({ id, original: true, version: '1.0.0', hashes })
}

export async function create_original_catalog(root: string, options: { include_hero?: boolean; css?: string } = {}): Promise<void> {
  await mkdir(root, { recursive: true })
  const entry = await create_original_skin(root, options)
  await writeFile(join(root, 'catalog.json'), `[${entry}]\n`)
}
