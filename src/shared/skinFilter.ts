import type { SkinSummary } from './skins'
import { SKIN_CATEGORY_LABELS } from './skins'

export function filter_skins(skins: SkinSummary[], query: string, category: string): SkinSummary[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  return skins.filter((skin) => {
    if (category !== 'all' && skin.category !== category) return false
    if (!needle) return true
    return `${skin.name} ${skin.description} ${skin.tags.join(' ')} ${SKIN_CATEGORY_LABELS[skin.category]} ${skin.category}`
      .toLocaleLowerCase('zh-CN')
      .includes(needle)
  })
}
