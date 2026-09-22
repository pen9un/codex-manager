import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { read_local_prompt } from '../src/main/localPrompt'

describe('本机提示词读取', () => {
  it('读取 config.toml 指向的提示词文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-prompt-'))
    try {
      await writeFile(join(root, 'config.toml'), 'experimental_instructions_file = "instructions/current.md"\n', 'utf8')
      await mkdir(join(root, 'instructions'))
      await writeFile(join(root, 'instructions', 'current.md'), '# 本机指令\n\n优先使用本地配置。\n', 'utf8')
      const result = await read_local_prompt(root, 'fallback')
      expect(result.content).toContain('本机指令')
      expect(result.source).toContain('current.md')
      expect(result.source_warning).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('找不到外部文件时回退到应用当前草稿并明确来源', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-prompt-'))
    try {
      const result = await read_local_prompt(root, 'fallback')
      expect(result.content).toBe('fallback')
      expect(result.source_warning).toContain('未在本机 Codex 配置')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
