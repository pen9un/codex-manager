import { describe, expect, it } from 'vitest'
import type { SkinSummary } from '../src/shared/skins'
import { filter_skins } from '../src/shared/skinFilter'

const skins = [
  { id: 'moon', name: '月下花园', description: '安静自然', category: 'nature', tags: ['月光', '治愈'], layout: 'dream-banner' },
  { id: 'pilot', name: '星海领航', description: '专业控制台', category: 'cyber', tags: ['效率', '蓝色'], layout: 'terminal-grid' },
] as SkinSummary[]

describe('皮肤库筛选', () => {
  it('同时按名称、描述、标签和中文分类搜索', () => {
    expect(filter_skins(skins, '领航', 'all').map(item => item.id)).toEqual(['pilot'])
    expect(filter_skins(skins, '安静', 'all').map(item => item.id)).toEqual(['moon'])
    expect(filter_skins(skins, '治愈', 'all').map(item => item.id)).toEqual(['moon'])
    expect(filter_skins(skins, '自然', 'all').map(item => item.id)).toEqual(['moon'])
    expect(filter_skins(skins, '赛博科幻', 'all').map(item => item.id)).toEqual(['pilot'])
  })

  it('分类筛选与搜索组合生效', () => {
    expect(filter_skins(skins, '', 'cyber').map(item => item.id)).toEqual(['pilot'])
    expect(filter_skins(skins, '月光', 'cyber')).toEqual([])
  })
})
