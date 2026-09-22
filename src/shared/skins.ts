export type SkinMode = 'light' | 'dark'
export type SkinPreviewView = 'home' | 'task' | 'settings' | 'components'
export type SkinCategory = 'trending' | 'anime' | 'geek' | 'cyber' | 'nature' | 'companions'
export type SkinContentKind = 'original' | 'ip-recreation' | 'user-characters'
export interface SkinPalette {
  background: string; panel: string; panelAlt: string; text: string
  muted: string; accent: string; secondary: string; border: string
  surface?: string; accentAlt?: string; highlight?: string
}
export interface SkinSummary {
  ui_revision?: 1
  id: string; name: string; description: string; category: SkinCategory; tags: string[]
  version: string; layout: string; modes: ['light', 'dark']; thumbnails: Record<SkinMode, string>
  thumbnail: string; has_preview: true; package_extension: 'codextheme'; motion: boolean; original: boolean; content_kind: SkinContentKind
}
export interface SkinPreview extends SkinSummary {
  images: Record<SkinMode, string>; image: string; palettes: Record<SkinMode, SkinPalette>
  focus_x: number; focus_y: number; radius: number; font: string; tagline: string
}
export const SKIN_CATEGORY_LABELS: Record<SkinCategory, string> = {
  trending: '潮流IP', anime: '动画幻想', geek: '极客黑客', cyber: '赛博科幻', nature: '自然人文', companions: '萌宠陪伴'
}
export const SKIN_CONTENT_KIND_LABELS: Record<SkinContentKind, string> = {
  original: '原创作品', 'ip-recreation': 'IP再创作', 'user-characters': '用户提供角色'
}
