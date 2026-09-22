import { createReadStream } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path'
import { MEMORY_EDIT_LIMIT } from '../shared/memory_types'

/** 同时检查根的祖先，避免根不存在时从父级链接进入其他目录。 */
export async function validate_memory_path(root: string, relative_path: string, allow_missing = false): Promise<string> {
  const parts = relative_path.split(/[\\/]/)
  if (isAbsolute(relative_path) || win32.isAbsolute(relative_path) || relative_path.includes(':') || relative_path.includes('\0') || parts.some(part => part === '..' || part === '.' || /[. ]$/.test(part))) {
    throw new Error('记忆路径不合法')
  }
  const root_path = resolve(root)
  const target = resolve(root_path, ...parts)
  const within = relative(root_path, target)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('记忆路径超出允许目录')
  const volume = parse(target).root
  let current = volume
  let missing = false
  for (const part of target.slice(volume.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (missing) continue
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error('记忆路径不允许符号链接或目录联接')
      if (current !== target && !info.isDirectory()) throw new Error('记忆路径父级不是目录')
      const actual = await realpath(current)
      const normalized = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
      if (normalized(actual) !== normalized(current)) throw new Error('记忆路径真实位置不一致')
    } catch (error) {
      if (allow_missing && (error as NodeJS.ErrnoException).code === 'ENOENT') missing = true
      else throw error
    }
  }
  return target
}

export async function hash_memory_file(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** 偏移按原始字节计数，分页边界退回字符起点。 */
export async function read_memory_page(file: string, offset = 0): Promise<{ content: string; offset: number; next_offset?: number; has_bom: boolean; newline: 'lf' | 'crlf' }> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('记忆分页位置不合法')
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || offset > info.size) throw new Error('记忆文件或分页位置不合法')
    if (info.size <= MEMORY_EDIT_LIMIT && offset !== 0) throw new Error('小型记忆文件应完整读取')
    const header = Buffer.alloc(Math.min(8192, info.size))
    await handle.read(header, 0, header.length, 0)
    const has_bom = header.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    let newline: 'lf' | 'crlf' = header.includes(Buffer.from('\r\n')) ? 'crlf' : 'lf'
    const length = Math.min(info.size - offset, info.size <= MEMORY_EDIT_LIMIT ? MEMORY_EDIT_LIMIT : 256 * 1024)
    const buffer = Buffer.alloc(Math.min(info.size - offset, length + 4))
    const { bytesRead: bytes_read } = await handle.read(buffer, 0, buffer.length, offset)
    let end = Math.min(length, bytes_read)
    if (offset + end < info.size) while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, end)) }
    catch { throw new Error('记忆文件包含损坏的 UTF-8 文本或分页位置不在字符边界') }
    if (offset === 0 && has_bom) content = content.slice(1)
    if (info.size <= MEMORY_EDIT_LIMIT) newline = content.includes('\r\n') ? 'crlf' : 'lf'
    if (content.includes('\0')) throw new Error('记忆文件包含二进制内容')
    return { content, offset, next_offset: offset + end < info.size ? offset + end : undefined, has_bom, newline }
  } finally { await handle.close() }
}
