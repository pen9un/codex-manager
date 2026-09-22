import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launch_codex_theme } from '../src/main/theme_connection'

const state = vi.hoisted(() => ({ installation: { executable: 'C:\\CodexFixture\\app\\ChatGPT.exe' as string | null, running: true, diagnostics: [] as string[] }, spawn: vi.fn(), discover: vi.fn() }))
const original_platform = process.platform
const inspector_state = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('../src/main/theme_inspector', () => ({ connect_inspector_theme: inspector_state.connect }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  const exec_file = Object.assign(() => {}, { [promisify.custom]: async (...args: unknown[]) => {
    state.discover(...args)
    return { stdout: JSON.stringify(state.installation), stderr: '' }
  } })
  return { execFile: exec_file, spawn: state.spawn }
})

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  state.installation = { executable: 'C:\\CodexFixture\\app\\ChatGPT.exe', running: true, diagnostics: [] }
  state.spawn.mockReset(); state.discover.mockClear()
  inspector_state.connect.mockReset().mockImplementation(async (wake: boolean) => { if (wake) throw Error('当前运行时没有可验证的无重启调试唤醒入口'); return [] })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('合成端口未开放')))
})
afterEach(() => { Object.defineProperty(process, 'platform', { value: original_platform, configurable: true }); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Codex 启动保护', () => {
  it('非 Windows 尝试运行时连接，不使用 Windows 发现与启动', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await expect(launch_codex_theme()).rejects.toThrow('无重启调试唤醒入口')
    expect(inspector_state.connect).toHaveBeenCalledWith(true)
    expect(state.discover).not.toHaveBeenCalled(); expect(state.spawn).not.toHaveBeenCalled()
  })
  it('已有可用 CDP 连接时直接复用，不查询安装或重复启动', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify([{ id: 'fixture', type: 'page', url: 'app://codex-test', webSocketDebuggerUrl: 'ws://127.0.0.1:9341/devtools/page/fixture' }]) }))
    class FixtureSocket extends EventTarget {
      constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
      send(data: string) {
        const { id } = JSON.parse(data)
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: { result: { value: { title: 'Codex', modeButtonText: 'Codex', modeButtonLabel: '', markers: { shell: true, sidebar: true, main: true } } } } }) })))
      }
      close() { this.dispatchEvent(new Event('close')) }
    }
    vi.stubGlobal('WebSocket', FixtureSocket)
    await expect(launch_codex_theme()).resolves.toBeUndefined()
    expect(state.discover).not.toHaveBeenCalled(); expect(state.spawn).not.toHaveBeenCalled()
  })
  it('已运行但未开放调试端口时保留进程，不重复启动', async () => {
    await expect(launch_codex_theme()).rejects.toThrow('无重启调试唤醒入口')
    expect(state.spawn).not.toHaveBeenCalled()
  })
  it('未通过签名发现时返回具体诊断，不启动程序', async () => {
    state.installation = { executable: null, running: false, diagnostics: ['安装包可执行文件签名无效'] }
    await expect(launch_codex_theme()).rejects.toThrow('签名无效')
    expect(state.spawn).not.toHaveBeenCalled()
  })
  it('调用 Windows PowerShell 时隔离继承的跨版本模块目录', async () => {
    vi.stubEnv('PSModulePath', 'C:\\PowerShell7\\Modules')
    await expect(launch_codex_theme()).rejects.toThrow('无重启调试唤醒入口')
    const options = state.discover.mock.calls[0][2]
    expect(Object.keys(options.env).some(key => key.toLowerCase() === 'psmodulepath')).toBe(false)
    expect(options.windowsHide).toBe(true)
  })
  it('未运行时使用本机调试地址启动，连接超时不能误报成功', async () => {
    vi.useFakeTimers(); state.installation.running = false
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    state.spawn.mockImplementation(() => { setTimeout(() => child.emit('spawn'), 0); return child })
    const result = expect(launch_codex_theme()).rejects.toThrow('连接尚未就绪')
    await vi.advanceTimersByTimeAsync(16000)
    await result
    expect(state.spawn).toHaveBeenCalledWith('C:\\CodexFixture\\app\\ChatGPT.exe', ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9341'], { windowsHide: true, detached: true, stdio: 'ignore' })
  })
  it('系统拒绝启动时返回失败，不进入连接成功状态', async () => {
    state.installation.running = false
    const child = new EventEmitter()
    state.spawn.mockImplementation(() => { queueMicrotask(() => child.emit('error', Error('合成启动失败'))); return child })
    await expect(launch_codex_theme()).rejects.toThrow('Codex 启动失败')
  })
  it.each(['win32', 'darwin', 'linux'])('平台 %s 可复用已有 Inspector，不启动或唤醒', async platform => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    const close = vi.fn()
    inspector_state.connect.mockResolvedValue([{ id: 'inspector:123:1', close }])
    await expect(launch_codex_theme()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
    expect(state.spawn).not.toHaveBeenCalled(); expect(state.discover).not.toHaveBeenCalled()
    expect(inspector_state.connect).not.toHaveBeenCalledWith(true)
  })
  it('Windows 运行中唤醒成功后关闭临时连接，不生成新进程', async () => {
    const close = vi.fn()
    inspector_state.connect.mockImplementation(async wake => wake ? [{ id: 'inspector:123:1', close }] : [])
    await expect(launch_codex_theme()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce(); expect(state.spawn).not.toHaveBeenCalled()
  })
})
