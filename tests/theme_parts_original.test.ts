import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build_original_payload, type OriginalExtension } from '../src/main/original_engine'

const root = process.cwd()
const engine_root = join(root, 'resources', 'theme-engine')
const theme_root = join(root, 'resources', 'skins', 'pixel-studio')

async function original_extension(): Promise<OriginalExtension> {
  const manifest = JSON.parse(await readFile(join(theme_root, 'theme.json'), 'utf8'))
  return manifest.codexManager
}

describe('原创主题语义区域集成', () => {
  it('仅在 ui_revision 为 1 时把可序列化安装器写入负载', async () => {
    const extension = await original_extension()
    // 二十组均已升级，显式构造旧配置以继续验证兼容分支。
    delete extension.ui_revision
    const legacy = await build_original_payload(engine_root, theme_root, extension, 'dark', false)
    const revised = await build_original_payload(engine_root, theme_root, { ...extension, ui_revision: 1 }, 'dark', false)

    expect(legacy.includes('__CODEX_MANAGER_THEME_PARTS_STATE__')).toBe(false)
    expect(revised.includes('__CODEX_MANAGER_THEME_PARTS_STATE__')).toBe(true)
    expect(revised.includes('install_theme_parts')).toBe(true)
  })
})
