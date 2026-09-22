import { theme_preview_html } from './theme_preview'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { zipSync } from 'fflate'
import type { SkinCategory, SkinContentKind, SkinMode, SkinPalette, SkinPreview, SkinPreviewView, SkinSummary } from '../shared/skins'
import { build_original_payload, type OriginalExtension, type OriginalMotion } from './original_engine'

interface CatalogEntry {
  id: string
  original: boolean
  content_kind: SkinContentKind
  version: string
  hashes: Record<string, string>
}

interface OriginalConfig {
  schemaVersion: 2; id: string; version: string; name: string; description: string; tagline: string; tags: string[]
  hero: string; preview: string; light: SkinPalette; dark: SkinPalette; layout: string
  heroFocusX?: number; heroFocusY?: number; radius?: string; fontPreset?: string
  codexManager: OriginalExtension & {
    category: SkinCategory; thumbnails: Record<SkinMode, string>; original: boolean; content_kind: SkinContentKind
  }
}

interface VerifiedSkin {
  entry: CatalogEntry
  config: OriginalConfig
  files: Record<string, Buffer>
}

const categories = new Set<SkinCategory>(['trending', 'anime', 'geek', 'cyber', 'nature', 'companions'])
const legacy_categories: Record<string, SkinCategory> = { professional: 'geek', fantasy: 'anime', characters: 'anime' }
const content_kinds = new Set<SkinContentKind>(['original', 'ip-recreation', 'user-characters'])
const motions = new Set<OriginalMotion>(['none', 'orbit', 'rain', 'cloud', 'float', 'breeze', 'moonlight'])
const layouts = new Set(['dream-banner', 'split-studio', 'full-canvas', 'cinematic-live', 'terminal-grid', 'paper-board', 'minimal-focus', 'retro-messenger', 'silk-scroll'])
const standard_fields = ['uuid', 'minEngineVersion', 'heroFit', 'heroFocusX', 'heroFocusY', 'heroZoom', 'heroHeight', 'heroTextAlign', 'heroScrim', 'wallpaperEnabled', 'wallpaperFocusX', 'wallpaperFocusY', 'wallpaperOpacity', 'wallpaperBlur', 'radius', 'density', 'fontPreset', 'glass', 'shadow', 'decoration', 'effects', 'brandSubtitle', 'projectPrefix', 'projectLabel', 'statusText', 'quote']
const palette_fields = ['background', 'panel', 'panelAlt', 'surface', 'text', 'muted', 'border', 'accent', 'accentAlt', 'secondary', 'highlight']
const safe_color = /^(?:#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i
const resource_root = (): string => join(__dirname, '../../resources/skins')
const engine_root = (): string => join(__dirname, '../../resources/theme-engine')
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const media_type = (name: string): string => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' })[extname(name).toLowerCase()] || 'application/octet-stream'
const data_url = (name: string, bytes: Uint8Array): string => `data:${media_type(name)};base64,${Buffer.from(bytes).toString('base64')}`
const is_record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const safe_name = (name: unknown): name is string => typeof name === 'string' && !!name && basename(name) === name && !name.includes('\\') && !/^[a-z]+:/i.test(name)

function validate_entry(value: unknown): CatalogEntry {
  if (!is_record(value) || typeof value.id !== 'string' || !/^[a-z0-9-]+$/.test(value.id) || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version) || !is_record(value.hashes)) throw Error('主题目录格式无效')
  const content_kind = validate_content_kind(value)
  for (const [name, hash] of Object.entries(value.hashes)) if (!safe_name(name) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw Error('主题资源清单无效')
  return { ...value, content_kind } as unknown as CatalogEntry
}

function validate_content_kind(value: Record<string, unknown>): SkinContentKind {
  const content_kind = 'content_kind' in value ? value.content_kind : 'original'
  if (!content_kinds.has(content_kind as SkinContentKind) || value.original !== (content_kind === 'original')) throw Error('主题来源配置无效')
  return content_kind as SkinContentKind
}

async function read_catalog(root: string): Promise<CatalogEntry[]> {
  let parsed: unknown
  try { parsed = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8')) }
  catch { throw Error('主题目录无法读取') }
  if (!Array.isArray(parsed)) throw Error('主题目录格式无效')
  const entries = parsed.map(validate_entry)
  if (new Set(entries.map(item => item.id)).size !== entries.length) throw Error('主题目录存在重复标识')
  return entries
}

async function read_verified(entry: CatalogEntry, root: string, name: string, max_bytes: number): Promise<Buffer> {
  if (!safe_name(name) || !entry.hashes[name]) throw Error(`主题资源未登记：${String(name)}`)
  const file = join(root, entry.id, name)
  const information = await stat(file).catch(() => undefined)
  if (!information?.isFile() || information.size <= 0 || information.size > max_bytes) throw Error(`主题资源缺失或大小无效：${name}`)
  const bytes = await readFile(file)
  if (sha256(bytes) !== entry.hashes[name]) throw Error(`主题资源校验失败：${name}`)
  return bytes
}

function validate_config(raw: unknown, entry: CatalogEntry): OriginalConfig {
  if (!is_record(raw) || raw.schemaVersion !== 2 || raw.id !== entry.id || raw.version !== entry.version || typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.description !== 'string' || typeof raw.tagline !== 'string' || !Array.isArray(raw.tags) || raw.tags.some(tag => typeof tag !== 'string') || typeof raw.layout !== 'string' || !is_record(raw.light) || !is_record(raw.dark) || !is_record(raw.codexManager)) throw Error('主题配置无效')
  if (standard_fields.some(field => !(field in raw)) || !layouts.has(raw.layout)) throw Error('主题配置无效')
  for (const palette of [raw.light, raw.dark]) {
    if (palette_fields.some(field => typeof palette[field] !== 'string' || !safe_color.test(palette[field] as string))) throw Error('主题配色无效')
  }
  const extension = raw.codexManager
  if ('ui_revision' in extension && extension.ui_revision !== 1) throw Error('主题组件样式版本无效')
  const content_kind = validate_content_kind(extension)
  if (content_kind !== entry.content_kind) throw Error('主题目录与配置来源不一致')
  const category = typeof extension.category === 'string' && Object.hasOwn(legacy_categories, extension.category) ? legacy_categories[extension.category] : extension.category
  if (!categories.has(category as SkinCategory) || !motions.has(extension.motion as OriginalMotion) || !is_record(extension.art) || !is_record(extension.thumbnails) || !safe_name(extension.style)) throw Error('主题扩展配置无效')
  const names = [raw.hero, raw.preview, extension.art.light, extension.art.dark, extension.thumbnails.light, extension.thumbnails.dark, extension.style]
  if (names.some(name => !safe_name(name)) || raw.hero !== extension.art.light || raw.preview !== extension.thumbnails.light) throw Error('主题资源路径无效')
  for (const name of names) if (!entry.hashes[name as string]) throw Error(`主题资源未登记：${String(name)}`)
  for (const required of ['theme.json', 'LICENSE.txt', 'NOTICE.txt', 'provenance.json']) if (!entry.hashes[required]) throw Error(`主题资源未登记：${required}`)
  return { ...raw, codexManager: { ...extension, category, content_kind } } as unknown as OriginalConfig
}

async function read_config(entry: CatalogEntry, root: string): Promise<{ config: OriginalConfig; bytes: Buffer }> {
  const bytes = await read_verified(entry, root, 'theme.json', 512 * 1024)
  let parsed: unknown
  try { parsed = JSON.parse(bytes.toString('utf8')) }
  catch { throw Error('主题配置不是有效 JSON') }
  return { config: validate_config(parsed, entry), bytes }
}

function summary(entry: CatalogEntry, config: OriginalConfig, thumbnails: Record<SkinMode, string>): SkinSummary {
  return {
    id: entry.id, name: config.name, description: config.description, category: config.codexManager.category,
    ...(config.codexManager.ui_revision === 1 ? { ui_revision: 1 as const } : {}),
    tags: [...config.tags], version: entry.version, layout: config.layout, modes: ['light', 'dark'],
    thumbnails, thumbnail: thumbnails.light, has_preview: true, package_extension: 'codextheme',
    motion: config.codexManager.motion !== 'none', original: config.codexManager.original, content_kind: config.codexManager.content_kind,
  }
}

async function read_full_skin(id: string, root: string): Promise<VerifiedSkin> {
  if (!/^[a-z0-9-]+$/.test(id)) throw Error('主题不存在')
  const entry = (await read_catalog(root)).find(item => item.id === id)
  if (!entry) throw Error('主题不存在')
  const { config } = await read_config(entry, root)
  const directory = join(root, id)
  const items = await readdir(directory, { withFileTypes: true })
  if (items.some(item => !item.isFile() || !entry.hashes[item.name])) throw Error('主题目录包含未登记资源')
  if (items.length !== Object.keys(entry.hashes).length) throw Error('主题资源不完整')
  const files: Record<string, Buffer> = {}
  for (const name of Object.keys(entry.hashes)) files[name] = await read_verified(entry, root, name, 32 * 1024 * 1024)
  const css = files[config.codexManager.style].toString('utf8')
  if (/@import\b|url\s*\(|expression\s*\(|<\/script/i.test(css)) throw Error('主题样式包含不允许的外部资源')
  return { entry, config, files }
}

export async function list_skins(root = resource_root()): Promise<SkinSummary[]> {
  return Promise.all((await read_catalog(root)).map(async entry => {
    const { config } = await read_config(entry, root)
    const light_name = config.codexManager.thumbnails.light
    const dark_name = config.codexManager.thumbnails.dark
    const [light, dark] = await Promise.all([
      read_verified(entry, root, light_name, 8 * 1024 * 1024),
      read_verified(entry, root, dark_name, 8 * 1024 * 1024),
    ])
    return summary(entry, config, { light: data_url(light_name, light), dark: data_url(dark_name, dark) })
  }))
}

export async function load_skin(id: string, root = resource_root()): Promise<SkinPreview> {
  const { entry, config, files } = await read_full_skin(id, root)
  const thumbnails = {
    light: data_url(config.codexManager.thumbnails.light, files[config.codexManager.thumbnails.light]),
    dark: data_url(config.codexManager.thumbnails.dark, files[config.codexManager.thumbnails.dark]),
  }
  const images = {
    light: data_url(config.codexManager.art.light, files[config.codexManager.art.light]),
    dark: data_url(config.codexManager.art.dark, files[config.codexManager.art.dark]),
  }
  return {
    ...summary(entry, config, thumbnails), images, image: images.light, palettes: { light: config.light, dark: config.dark },
    focus_x: config.heroFocusX ?? 0.5, focus_y: config.heroFocusY ?? 0.5,
    radius: ({ none: 0, sm: 8, md: 16, lg: 24, xl: 32 })[config.radius || 'md'] ?? 16,
    font: config.fontPreset === 'mono' ? 'monospace' : 'inherit', tagline: config.tagline,
  }
}

export async function export_skin(id: string, root = resource_root()): Promise<Uint8Array> {
  const { files } = await read_full_skin(id, root)
  return zipSync(files, { level: 6 })
}

export async function build_skin_payload(id: string, motion_enabled: boolean, root = resource_root(), assets = engine_root(), mode?: SkinMode): Promise<string> {
  if (typeof motion_enabled !== 'boolean') throw Error('主题动效设置无效')
  const { config } = await read_full_skin(id, root)
  return build_original_payload(assets, join(root, id), config.codexManager, mode, motion_enabled)
}

export async function render_skin_preview(id: string, mode: SkinMode, view: SkinPreviewView, motion_enabled: boolean, root = resource_root()): Promise<string> {
  if (!['light', 'dark'].includes(mode) || !['home', 'task', 'settings', 'components'].includes(view) || typeof motion_enabled !== 'boolean') throw Error('主题预览参数无效')
  const { config } = await read_full_skin(id, root)
  if (config.codexManager.ui_revision !== 1 && ['settings', 'components'].includes(view)) throw Error('此主题尚未提供完整组件预览')
  const payload = await build_skin_payload(id, motion_enabled, root, join(root, '..', 'theme-engine'), mode)
  return theme_preview_html(config, mode, view, payload)
}
