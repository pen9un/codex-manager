import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MarkdownView } from '../src/renderer/src/MarkdownView'
import { redactMcp, restoreMcpSecrets, SECRET_PLACEHOLDER } from '../src/main/mcpSecrets'
import { normalizeAccount, statusOf } from '../src/main/account'

describe('review regressions', () => {
  it('renders semantic Markdown and keeps unsafe links inert', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {source: '# Heading\n\n**Strong** and *emphasis*\n\n- One\n- Two\n\n1. Ordered\n2. Two\n\n> Quote\n\n```ts\nconst x = 1\n```\n\n<script>alert(1)</script>\n[bad](javascript:evil)\n[good](https://example.com)'}))
    expect(html).toContain('<ul>'); expect(html).toMatch(/<ol(?: start="1")?>/); expect(html).toContain('<strong>Strong</strong>'); expect(html).toContain('<em>emphasis</em>'); expect(html).toContain('<pre'); expect(html).toContain('<blockquote>'); expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:'); expect(html).toContain('href="https://example.com"')
  })
  it('renders GitHub 风格表格为语义化表格', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {source: '| 名称 | 状态 |\n| --- | :---: |\n| MCP | 已启用 |\n| Skill | 待审查 |'}))
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<th>名称</th>')
    expect(html).toContain('<tbody>')
    expect(html).toMatch(/<td[^>]*>已启用<\/td>/)
  })
  it('redacts argument and URL credentials and restores originals', () => {
    const input = { args: ['server.js', '--api-key', 'sensitive', '--token=also-sensitive'], url: 'https://user:pass@example.com/?token=hidden' }
    const masked = redactMcp(input)
    expect(masked.args).toEqual(['server.js', '--api-key', SECRET_PLACEHOLDER, SECRET_PLACEHOLDER]); expect(masked.url).toBe(SECRET_PLACEHOLDER)
    expect(restoreMcpSecrets(masked, input)).toEqual(input)
  })
  it('rejects invalid imported timestamps and treats legacy dates as unknown', () => {
    const input = {email:'qa@example.com',chatgpt_account_id:'qa',access_token:'qa',id_token:'qa',refresh_token:'qa',expires_at:'nonsense'}
    expect(()=>normalizeAccount(input)).toThrow('时间')
    const account = normalizeAccount({...input,expires_at:undefined}); account.expiresAt='invalid'
    expect(statusOf(account)).toBe('unknown')
  })
})
