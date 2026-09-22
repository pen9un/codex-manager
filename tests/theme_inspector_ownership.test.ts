import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { close_owned_inspectors, connect_inspector_theme } from '../src/main/theme_inspector'

const state = vi.hoisted(() => ({ ports: [] as number[], endpoint: 'owned', windows: true, reported_pid: 123, wake: vi.fn(), closed_listeners: [] as string[], expressions: [] as string[] }))
vi.mock('../src/main/theme_process', () => ({
  can_wake_process: () => true, has_signal_handler: () => true,
  discover_theme_processes: async () => [{ pid: 123, identity: '123:出生时间', executable: '/fixture/Codex', ports: state.ports, wake_proof: 'windows-handler' }],
  wake_theme_process: async () => { state.wake(); state.ports = [9229] },
}))
vi.mock('node:net', () => ({ createServer: () => ({ once() { return this }, listen(_port: number, _host: string, callback: () => void) { callback() }, close(callback: () => void) { callback() } }) }))
vi.mock('../src/main/theme_rpc', () => ({ open_runtime_connection: async (id: string) => ({ id, close: vi.fn(), evaluate: async (expression: string) => {
  state.expressions.push(expression)
  if (expression === 'process.pid') return state.reported_pid
  if (expression.includes('getAllWindows')) return state.windows ? [{ id: 1, url: 'app://-/index.html' }] : []
  if (expression.startsWith('setTimeout(')) { state.closed_listeners.push(state.endpoint); return true }
  return { value: { title: 'Codex', modeButtonText: 'Codex', modeButtonLabel: '', markers: { shell: true, sidebar: true, main: true } } }
} }) }))

beforeEach(() => {
  state.ports = []; state.endpoint = 'owned'; state.windows = true; state.reported_pid = 123
  state.wake.mockClear(); state.closed_listeners = []; state.expressions = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, text: async () => JSON.stringify([{ id: state.endpoint, type: 'node', webSocketDebuggerUrl: `ws://127.0.0.1:${new URL(url).port}/${state.endpoint}` }]) })))
})
afterEach(async () => { await close_owned_inspectors(); vi.unstubAllGlobals() })

describe('Inspector 所有权', () => {
  it('已有自定义端点但无可用窗口时，不唤醒也不关闭既有服务', async () => {
    state.ports = [9337]; state.windows = false
    await expect(connect_inspector_theme(true)).rejects.toThrow('已有 Inspector')
    await close_owned_inspectors()
    expect(state.wake).not.toHaveBeenCalled(); expect(state.closed_listeners).toEqual([])
  })
  it('仅关闭本管理器唤醒的同一端点，延迟回调也核对地址', async () => {
    const connections = await connect_inspector_theme(true)
    connections.forEach(connection => connection.close())
    expect(state.wake).toHaveBeenCalledOnce()
    await close_owned_inspectors()
    expect(state.closed_listeners).toEqual(['owned'])
    expect(state.expressions.find(expression => expression.startsWith('setTimeout('))).toContain('inspector.url()===')
  })
  it('同一进程后来更换 Inspector 端点时，不关闭新端点', async () => {
    const connections = await connect_inspector_theme(true)
    connections.forEach(connection => connection.close())
    state.endpoint = 'user-new-endpoint'
    await close_owned_inspectors()
    expect(state.closed_listeners).toEqual([])
  })
  it('状态检测不主动唤醒进程', async () => {
    expect(await connect_inspector_theme()).toEqual([])
    expect(state.wake).not.toHaveBeenCalled()
  })
  it('Inspector 返回不同 PID 时只读探测后拒绝页面操作', async () => {
    state.ports = [9337]; state.reported_pid = 999
    expect(await connect_inspector_theme()).toEqual([])
    expect(state.expressions.every(expression => expression === 'process.pid')).toBe(true)
  })
})
