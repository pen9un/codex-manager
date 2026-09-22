import { describe, expect, it } from 'vitest'
import { jsonToMcp } from '../src/main/mcp'

describe('MCP JSON validation', () => {
  it('accepts standard stdio and HTTP servers', () => {
    const result = jsonToMcp({ mcpServers: { docs: { command: 'npx', args: ['-y', 'docs'] }, remote: { url: 'https://example.test/mcp', default_tools_approval_mode: 'prompt', tool_timeout_sec: 30 } } })
    expect(Object.keys(result)).toEqual(['docs', 'remote'])
  })
  it('rejects ambiguous transport and invalid policy', () => {
    expect(() => jsonToMcp({ mcpServers: { bad: { command: 'node', url: 'https://example.test' } } })).toThrow()
    expect(() => jsonToMcp({ mcpServers: { bad: { command: 'node', default_tools_approval_mode: 'unsafe' } } })).toThrow()
  })
})
