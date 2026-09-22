import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parse_toml } from '@iarna/toml'
export interface LocalPromptSource { content: string; source: string; source_warning?: string }
async function read_prompt_file(path: string): Promise<string> { if ((await stat(path)).size > 1024 * 1024) throw new Error('指令文件超过 1 MiB，无法完整预览'); return (await readFile(path, 'utf8')).trim() }
export async function read_local_prompt(codex_home: string, fallback_content: string): Promise<LocalPromptSource> {
  const parts: string[] = [], sources: string[] = [], warnings: string[] = []; let config: Record<string, any> = {}
  try { config = parse_toml(await readFile(join(codex_home, 'config.toml'), 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('config.toml 读取失败，请检查文件权限和 TOML 格式。') }
  const profile = typeof config.profile === 'string' ? config.profiles?.[config.profile] : undefined
  const effective = profile && typeof profile === 'object' ? { ...config, ...profile } : config
  const configured_path = effective.model_instructions_file ?? effective.experimental_instructions_file
  if (typeof configured_path === 'string' && configured_path.trim()) {
    const expanded = configured_path.replace(/^~[\\/]/, `${homedir()}/`); const prompt_path = resolve(codex_home, expanded)
    try { const content = await read_prompt_file(prompt_path); if (content) { parts.push(content); sources.push(prompt_path) } else warnings.push(`指令文件为空：${prompt_path}`) } catch { warnings.push(`指令文件读取失败：${prompt_path}。请检查路径、权限和文件大小。`) }
  }
  if (typeof effective.developer_instructions === 'string' && effective.developer_instructions.trim()) { parts.push(effective.developer_instructions.trim()); sources.push('config.toml · developer_instructions') }
  for (const name of ['AGENTS.override.md', 'AGENTS.md']) { try { const content = await read_prompt_file(join(codex_home, name)); if (content) { parts.push(content); sources.push(join(codex_home, name)); break } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${name} 读取失败，请检查文件权限和大小。`) } }
  if (parts.length) return { content: parts.join('\n\n'), source: sources.join('；'), source_warning: warnings.length ? warnings.join(' ') : undefined }
  return { content: fallback_content, source: '本应用已保存草稿（未检测到本机指令）', source_warning: [...warnings, '未在本机 Codex 配置中找到可读取的全局指令；此项展示应用草稿，不代表 Codex 完整系统提示词。'].join(' ') }
}
