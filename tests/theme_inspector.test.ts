import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { can_wake_process, has_signal_handler, validate_inspector_target, page_bridge_expression } from '../src/main/theme_inspector'

describe('运行中主题连接的边界', () => {
  it('仅接受当前进程拥有的本机 Node Inspector', () => {
    const target = { id: 'node-1', type: 'node', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/node-1' }
    expect(validate_inspector_target(target, [9229])).toBe(target.webSocketDebuggerUrl)
    for (const changed of [
      { type: 'page' }, { webSocketDebuggerUrl: 'ws://example.com:9229/node-1' },
      { webSocketDebuggerUrl: 'ws://127.0.0.1:9333/node-1' },
      { webSocketDebuggerUrl: 'ws://user@127.0.0.1:9229/node-1' },
    ]) expect(() => validate_inspector_target({ ...target, ...changed }, [9229])).toThrow()
  })
  it('信号位按平台传入，未知或截断值拒绝', () => {
    expect(has_signal_handler('0000000000000200', 10)).toBe(true)
    expect(has_signal_handler('0000000020000000', 30)).toBe(true)
    expect(has_signal_handler('0000000000000200', 30)).toBe(false)
    expect(has_signal_handler('', 10)).toBe(false)
    expect(has_signal_handler('未知', 10)).toBe(false)
  })
  it('不对缺乏唤醒证据的进程或不支持平台发信号', () => {
    expect(can_wake_process('win32', 'windows-handler')).toBe(true)
    expect(can_wake_process('linux', 'posix-signal')).toBe(true)
    expect(can_wake_process('darwin', 'electron-fuse')).toBe(true)
    expect(can_wake_process('darwin', null)).toBe(false)
    expect(can_wake_process('linux', null)).toBe(false)
    expect(can_wake_process('freebsd', 'posix-signal')).toBe(false)
    expect(can_wake_process('win32', 'posix-signal')).toBe(false)
  })
})

describe('页面 CDP 附加生命周期', () => {
  function fixture(attached = false) {
    const events = new EventEmitter()
    const debugger_api = {
      isAttached: () => attached,
      on: events.on.bind(events), removeListener: events.removeListener.bind(events),
      attach: vi.fn(() => { attached = true }), detach: vi.fn(() => { attached = false; events.emit('detach') }),
      sendCommand: vi.fn(async () => ({ result: { value: '合成页面返回值' } })),
    }
    const window = { isDestroyed: () => false, webContents: { getURL: () => 'app://-/index.html', debugger: debugger_api } }
    const electron = { BrowserWindow: { fromId: (id: number) => id === 1 ? window : null } }
    const context = { process: { execPath: '/fixture/codex', getBuiltinModule: () => ({ createRequire: () => () => electron }) }, setTimeout, clearTimeout }
    return { debugger_api, window, evaluate: (expression = 'document.title', id = 1) => runInNewContext(page_bridge_expression(id, expression), context) }
  }
  it('将表达式作为协议数据传递，操作完成释放自己的附加', async () => {
    const item = fixture()
    const expression = '"; throw new Error("不得在宿主执行"); //'
    expect(await item.evaluate(expression)).toEqual({ value: '合成页面返回值' })
    expect(item.debugger_api.sendCommand).toHaveBeenCalledWith('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    expect(item.debugger_api.detach).toHaveBeenCalledOnce()
  })
  it('不抢占或解除其他调试客户端', async () => {
    const item = fixture(true)
    expect(await item.evaluate()).toMatchObject({ error: expect.stringContaining('未抢占') })
    expect(item.debugger_api.attach).not.toHaveBeenCalled(); expect(item.debugger_api.detach).not.toHaveBeenCalled()
  })
  it('页面操作失败也释放附加，后续可以重新连接', async () => {
    const item = fixture()
    item.debugger_api.sendCommand.mockRejectedValueOnce(Error('合成失败'))
    expect(await item.evaluate()).toMatchObject({ error: expect.any(String) })
    expect(item.debugger_api.detach).toHaveBeenCalledOnce()
    expect(await item.evaluate()).toEqual({ value: '合成页面返回值' })
  })
  it('页面异常不伪装为成功', async () => {
    const item = fixture()
    item.debugger_api.sendCommand.mockResolvedValueOnce({ exceptionDetails: { text: '合成异常' } } as any)
    expect(await item.evaluate()).toMatchObject({ error: expect.any(String) })
    expect(item.debugger_api.detach).toHaveBeenCalledOnce()
  })
  it('调试会话中途被替换时不解除新调用方的附加', async () => {
    const item = fixture()
    item.debugger_api.sendCommand.mockImplementationOnce(async () => {
      item.debugger_api.detach(); item.debugger_api.attach()
      return { result: { value: '旧请求完成' } }
    })
    await item.evaluate()
    expect(item.debugger_api.detach).toHaveBeenCalledTimes(1)
    expect(item.debugger_api.isAttached()).toBe(true)
  })
  it('窗口关闭或离开应用协议后拒绝命令', async () => {
    const item = fixture()
    expect(await item.evaluate('document.title', 2)).toMatchObject({ error: expect.any(String) })
    item.window.webContents.getURL = () => 'https://example.com'
    expect(await item.evaluate()).toMatchObject({ error: expect.any(String) })
    expect(item.debugger_api.attach).not.toHaveBeenCalled()
  })
})
