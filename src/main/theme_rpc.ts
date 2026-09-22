import type { ThemeConnection } from './theme_connection'

// 页面端点和主进程端点共用传输；调用方必须先验证地址及进程归属。
export async function open_runtime_connection(id: string, url: string): Promise<ThemeConnection> {
  const socket = new WebSocket(url)
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let sequence = 0, closed = false
  const fail_all = () => { closed = true; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Codex 主题连接已断开')) }; pending.clear() }
  socket.addEventListener('close', fail_all)
  socket.addEventListener('message', event => {
    try {
      const message = JSON.parse(String(event.data)), item = pending.get(message.id)
      if (!item) return
      clearTimeout(item.timer); pending.delete(message.id)
      if (message.error || message.result?.exceptionDetails) item.reject(Error('Codex 未能执行主题操作'))
      else item.resolve(message.result?.result?.value)
    } catch { fail_all(); socket.close() }
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('连接 Codex 超时')) }, 3000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); fail_all(); socket.close(); reject(Error('无法连接 Codex')) }, { once: true })
  })
  return { id, close: () => { socket.close(); fail_all() }, evaluate: expression => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Codex 主题连接已断开')); return }
    const request_id = ++sequence
    const timer = setTimeout(() => { pending.delete(request_id); reject(Error('主题操作超时')) }, 15000)
    pending.set(request_id, { resolve, reject, timer })
    try { socket.send(JSON.stringify({ id: request_id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })) }
    catch { clearTimeout(timer); pending.delete(request_id); reject(Error('无法发送主题操作')) }
  }) }
}
