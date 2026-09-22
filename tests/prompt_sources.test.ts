import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPT, PROMPT_PRESETS } from '../src/shared/types'
import sources from '../src/shared/vendor/prompt-sources.json'

describe('固定版本上游提示词', () => {
  it('默认内容来自完整上游正文，不混入自编模板', () => {
    expect(PROMPT_PRESETS).toEqual(sources)
    expect(DEFAULT_PROMPT).toBe(sources[0].content)
    expect(sources.some(item => /superpowers/i.test(item.sourceUrl))).toBe(false)
    expect(new Set(sources.map(item => item.scenario)).size).toBeGreaterThanOrEqual(4)
  })
  it('每份正文可通过固定来源与摘要核验，并记录授权、场景和关注度', () => {
    for (const source of sources) {
      expect(createHash('sha256').update(source.content).digest('hex')).toBe(source.upstreamSha256)
      expect(source.sourceUrl).toMatch(/^https:\/\/github.com\/(github\/awesome-copilot|openai\/codex)\/blob\/[0-9a-f]{40}\//)
      expect(source.stars).toBeGreaterThan(10000)
      expect(source.license).toMatch(/^(MIT|Apache-2.0)$/)
      expect(source.sourceWarning).toBeTruthy()
      expect(source.scenario).toBeTruthy()
      expect(source.riskBoundary).toBeTruthy()
    }
  })
})
