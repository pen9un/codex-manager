import { createServer } from 'node:net'
import type { ThemeConnection } from './theme_connection'
import { open_runtime_connection } from './theme_rpc'
import { discover_theme_processes, wake_theme_process, type ThemeProcess } from './theme_process'
import { PROBE_EXPRESSION } from './vendor/codex-themes/engine/constants'
export { can_wake_process, has_signal_handler } from './theme_process'

interface InspectorTarget { id: string; type: string; webSocketDebuggerUrl: string }
const owned_inspectors = new Map<string, string>()
const queues = new Map<number, Promise<unknown>>()
let waking: Promise<ThemeConnection[]> | null = null
const electron_expression = 'process.getBuiltinModule("module").createRequire(process.execPath)("electron")'

export function validate_inspector_target(target: InspectorTarget, ports: number[]): string {
  const url = new URL(target.webSocketDebuggerUrl)
  if (target.type !== 'node' || !target.id || url.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !ports.includes(Number(url.port)) || url.username || url.password || url.search || url.hash || url.pathname !== `/${target.id}`) throw Error('拒绝未经进程归属验证的 Inspector 端点')
  return url.href
}

async function open_inspector(candidate: ThemeProcess): Promise<ThemeConnection | null> {
  for (const port of candidate.ports) {
    for (const host of ['127.0.0.1', '[::1]']) {
      try {
        const response = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(700), redirect: 'error' })
        const text = await response.text()
        if (!response.ok || text.length > 256000) continue
        const targets = JSON.parse(text) as InspectorTarget[]
        if (!Array.isArray(targets) || targets.length > 16) continue
        for (const target of targets) {
          let connection: ThemeConnection | undefined
          try {
            const endpoint = validate_inspector_target(target, candidate.ports)
            connection = await open_runtime_connection(endpoint, endpoint)
            if (await connection.evaluate<number>('process.pid') !== candidate.pid) throw Error('Inspector 进程身份不一致')
            return connection
          } catch { connection?.close() }
        }
      } catch { /* 该监听端口不是可用的 Inspector，继续检查同进程端点。 */ }
    }
  }
  return null
}

function serialize<T>(pid: number, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(pid) || Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  queues.set(pid, next)
  void next.finally(() => { if (queues.get(pid) === next) queues.delete(pid) }).catch(() => {})
  return next
}

export function page_bridge_expression(window_id: number, expression: string): string {
  if (!Number.isSafeInteger(window_id) || window_id < 1) throw Error('Codex 窗口标识无效')
  return `(async()=>{
    const e=${electron_expression},w=e.BrowserWindow.fromId(${window_id});
    if(!w||w.isDestroyed()||!w.webContents.getURL().startsWith('app://'))return {error:'Codex 工作窗口已关闭或发生变化'};
    const d=w.webContents.debugger;
    if(!d||typeof d.attach!=='function')return {error:'当前 Codex 运行时不支持页面调试桥接'};
    if(d.isAttached())return {error:'该 Codex 窗口已有调试连接，未抢占现有会话'};
    let attached=false,timer;
    const detached=()=>{attached=false};
    d.on('detach',detached);
    try {
      d.attach('1.3');attached=true;
      const result=await Promise.race([
        d.sendCommand('Runtime.evaluate',{expression:${JSON.stringify(expression)},returnByValue:true,awaitPromise:true}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('页面主题操作超时')),12000)})
      ]);
      if(result.exceptionDetails)return {error:'页面未能执行主题操作'};
      return {value:result.result?.value};
    } catch {return {error:'Codex 页面调试操作失败'};}
    finally{clearTimeout(timer);d.removeListener('detach',detached);if(attached&&d.isAttached())d.detach();}
  })()`
}

export async function connect_inspector_process(candidate: ThemeProcess): Promise<ThemeConnection[]> {
  const main = await open_inspector(candidate)
  if (!main) return []
  const connected: ThemeConnection[] = []
  try {
    const windows = await main.evaluate<Array<{ id: number; url: string }>>(`(()=>{const e=${electron_expression};return e.BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL()}))})()`)
    let references = 0
    for (const window of windows) {
      if (!window.url.startsWith('app://')) continue
      const evaluate = async <T>(expression: string): Promise<T> => serialize(candidate.pid, async () => {
        const result = await main.evaluate<{ value?: T; error?: string }>(page_bridge_expression(window.id, expression))
        if (!result || result.error) throw Error(result?.error || 'Codex 未返回页面桥接结果')
        return result.value as T
      })
      try {
        const probe = await evaluate<{ title: string; modeButtonText: string; modeButtonLabel: string; markers: Record<string, boolean> }>(PROBE_EXPRESSION)
        const mode = `${probe.modeButtonText} ${probe.modeButtonLabel}`.trim() || probe.title
        if (!/codex/i.test(mode) || /chatgpt/i.test(mode) || !probe.markers.shell || !probe.markers.sidebar || !probe.markers.main) continue
        references++
        let closed = false
        connected.push({ id: `inspector:${candidate.pid}:${window.id}`, evaluate: expression => {
          if (closed) return Promise.reject(Error('Codex 主题连接已关闭'))
          return evaluate(expression)
        }, close: () => { if (!closed) { closed = true; if (--references === 0) main.close() } } })
      } catch { /* 排除浮层、非工作窗口和已被其他调试客户端占用的窗口。 */ }
    }
    if (!connected.length) main.close()
    return connected
  } catch (error) { main.close(); throw error }
}

async function ensure_default_port_free(): Promise<void> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(Error('默认 Inspector 端口 9229 已被占用，未唤醒或重启 Codex')))
    server.listen(9229, '127.0.0.1', () => server.close(() => resolve()))
  })
}

async function connect_running(allow_wake: boolean): Promise<ThemeConnection[]> {
  const candidates = await discover_theme_processes()
  const result: ThemeConnection[] = []
  for (const candidate of candidates) {
    try { result.push(...await connect_inspector_process(candidate)) } catch { /* 缺少兼容接口时保留原进程。 */ }
  }
  if (result.length || !allow_wake) return result
  if (candidates.length !== 1) throw Error(candidates.length ? '发现多个 Codex 主进程，请明确保留需要换肤的实例后重试' : process.platform === 'linux' ? '未找到可信 Codex 桌面进程；Linux 请设置 CODEX_DESKTOP_EXECUTABLE 为桌面程序的绝对路径' : '未找到可验证的运行中 Codex 主进程')
  const candidate = candidates[0]
  const existing = await open_inspector(candidate)
  if (existing) { existing.close(); throw Error('Codex 已有 Inspector，但工作窗口暂不可连接或已被调试占用；未唤醒或关闭现有调试会话') }
  await ensure_default_port_free()
  await wake_theme_process(candidate)
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = (await discover_theme_processes()).find(item => item.identity === candidate.identity)
      if (!current) break
      const opened = await open_inspector(current)
      if (opened) { if (!owned_inspectors.has(candidate.identity)) owned_inspectors.set(candidate.identity, opened.id); opened.close() }
      const connected = await connect_inspector_process(current)
      if (connected.length) return connected
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  } catch (error) {
    await close_owned_inspectors().catch(() => {})
    throw error
  }
  await close_owned_inspectors()
  throw Error('Inspector 唤醒后未发现兼容的 Codex 工作窗口；客户端未退出、重启或刷新')
}

export function connect_inspector_theme(allow_wake = false): Promise<ThemeConnection[]> {
  if (!allow_wake) return connect_running(false)
  // 唤醒操作串行，调用方各自拥有连接，不能共享可关闭的连接对象。
  if (waking) return waking.then(connections => { void connections; return connect_running(false) })
  const operation = connect_running(true)
  waking = operation
  void operation.finally(() => { if (waking === operation) waking = null }).catch(() => {})
  return operation
}

export async function close_owned_inspectors(): Promise<void> {
  if (!owned_inspectors.size) return
  const current = await discover_theme_processes()
  for (const [identity, endpoint] of owned_inspectors) {
    const candidate = current.find(item => item.identity === identity)
    if (!candidate) { owned_inspectors.delete(identity); continue }
    const connection = await open_inspector(candidate)
    if (!connection) continue
    try {
      if (connection.id !== endpoint) { owned_inspectors.delete(identity); continue }
      // 先返回请求，延迟关闭监听，避免 Inspector.close 等待自身连接退出。
      await connection.evaluate(`setTimeout(()=>{const inspector=process.getBuiltinModule("inspector");if(inspector.url()===${JSON.stringify(endpoint)})inspector.close()},100);true`)
      owned_inspectors.delete(identity)
    } finally { connection.close() }
  }
}
