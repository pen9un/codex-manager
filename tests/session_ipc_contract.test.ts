import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('会话 IPC 契约', () => {
  it('主进程和 preload 暴露同一组会话方法', async () => {
    const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
    const declaration = await readFile(new URL('../src/preload/index.d.ts', import.meta.url), 'utf8')
    for (const name of ['sessions:list', 'sessions:detail', 'sessions:refresh', 'sessions:export', 'sessions:deletePreview', 'sessions:delete', 'sessions:backups', 'sessions:restore', 'sessions:backupDelete']) expect(main).toContain(name)
    for (const name of ['sessions', 'list', 'detail', 'refresh', 'export', 'deletePreview', 'delete', 'backups', 'restore', 'removeBackup']) {
      expect(preload).toContain(name)
      expect(declaration).toContain(name)
    }
  })
})
