import { createReadStream } from 'node:fs'

// 保留精确字节偏移，分页支持 UTF-8、LF/CRLF，不重新读取前面的正文。
export async function* read_session_lines(path: string, start = 0, end?: number): AsyncGenerator<{ text: string; offset: number; next: number; newline: string }> {
  const stream = createReadStream(path, { start, end, highWaterMark: 64 * 1024 })
  let parts: Buffer[] = []; let length = 0; let offset = start
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer
      let position = 0
      while (position < buffer.length) {
        const newline = buffer.indexOf(10, position)
        if (newline === -1) { const part = buffer.subarray(position); parts.push(part); length += part.length; break }
        const part = buffer.subarray(position, newline)
        const line = parts.length ? Buffer.concat([...parts, part], length + part.length) : part
        const carriage = line.length > 0 && line[line.length - 1] === 13
        const next = offset + line.length + 1
        yield { text: (carriage ? line.subarray(0, line.length - 1) : line).toString('utf8'), offset, next, newline: carriage ? '\r\n' : '\n' }
        offset = next; position = newline + 1; parts = []; length = 0
      }
    }
    if (length) {
      const line = Buffer.concat(parts, length)
      // 文件尾部没有换行时，CR 是正文的一部分，不能被当作 CRLF 剥掉。
      yield { text: line.toString('utf8'), offset, next: offset + length, newline: '' }
    }
  } finally { stream.destroy() }
}
