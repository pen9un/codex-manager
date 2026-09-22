import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AccountCredential, AppSettings, PromptConfig } from '../shared/types'
import { DEFAULT_PROMPT, DEFAULT_SETTINGS } from '../shared/types'

export interface VaultData { accounts: AccountCredential[]; activeId?: string; settings: AppSettings; prompt?: PromptConfig }
export class Vault {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(readonly path = join(app.getPath('userData'), 'accounts.vault')) {}
  update<T>(work: (data: VaultData) => T | Promise<T>): Promise<T> {
    const operation = this.tail.catch(() => {}).then(async () => {
      const data = await this.read()
      const result = await work(data)
      await this.write(data)
      return result
    })
    this.tail = operation
    return operation
  }
  async read(): Promise<VaultData> {
    try {
      const encrypted = Buffer.from(await readFile(this.path, 'utf8'), 'base64')
      const data = JSON.parse(safeStorage.decryptString(encrypted)) as Partial<VaultData>
      return { accounts: data.accounts || [], activeId: data.activeId, settings: { ...DEFAULT_SETTINGS, ...data.settings }, prompt: data.prompt || { content: DEFAULT_PROMPT, original: DEFAULT_PROMPT, history: [] } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accounts: [], settings: { ...DEFAULT_SETTINGS }, prompt: { content: DEFAULT_PROMPT, original: DEFAULT_PROMPT, history: [] } }
      throw new Error('无法读取本地凭据库，文件可能损坏或系统密钥已变化')
    }
  }
  private async write(data: VaultData): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，已拒绝保存明文凭据')
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(data)).toString('base64'), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }
}
