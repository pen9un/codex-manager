import { resolve } from 'node:path'
import type { SessionFileRef } from '../shared/types'

// 同一 Windows 文件的普通路径和扩展路径必须使用同一个比较键。
// 只用于比较，读取仍使用原路径，以保留超长路径能力和既有消息块 ID。
export function session_path_key(path: string): string {
  let key = resolve(path).replaceAll('\\', '/')
  if (key.toLowerCase().startsWith('//?/unc/')) key = `//${key.slice(8)}`
  else if (key.startsWith('//?/')) key = key.slice(4)
  return process.platform === 'win32' ? key.toLowerCase() : key
}

export function unique_session_files(refs: SessionFileRef[]): SessionFileRef[] {
  const seen = new Set<string>()
  return refs.filter(ref => {
    const key = session_path_key(ref.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
