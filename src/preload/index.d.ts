import type { ThemeBackup, ThemeRuntimeStatus } from '../shared/theme_runtime'
import type { SkinPreview, SkinSummary } from '../shared/skins'
import type { AccountImportPreview, AccountImportResult } from '../shared/types'
import type { AccountSummary, AppInfo, AppSettings, ExtensionInfo, McpServerSummary, OperationResult, PromptConfig, PromptPreset, SessionBackupSummary, SessionCatalog, SessionCursor, SessionDeletePreview, SessionDeleteRequest, SessionDeleteResult, SessionDetail, SessionExportRequest, SkillSummary } from '../shared/types'

declare global {
  interface Window {
    codexMemories: import('../shared/memory_types').MemoryApi
    codexAccounts: {
      list(): Promise<OperationResult<AccountSummary[]>>
      importText(raw: string): Promise<OperationResult<AccountImportPreview>>
      importFile(): Promise<OperationResult<AccountImportPreview | null>>
      importLocal(): Promise<OperationResult<AccountImportPreview>>
      confirmImport(preview_id: string): Promise<OperationResult<AccountImportResult>>
      cancelImport(preview_id: string): Promise<OperationResult<void>>
      activate(id: string): Promise<OperationResult>
      refresh(id: string): Promise<OperationResult>
      refreshAll(): Promise<OperationResult<number>>
      remove(id: string): Promise<OperationResult>
      removeMany(ids: string[]): Promise<OperationResult<number>>
      export(ids: string[]): Promise<OperationResult<number>>
      getSettings(): Promise<OperationResult<AppSettings>>
      saveSettings(settings: AppSettings): Promise<OperationResult>
      promptGet(): Promise<OperationResult<PromptConfig>>
      promptSave(content: string): Promise<OperationResult<PromptConfig>>
      promptReset(): Promise<OperationResult<PromptConfig>>
      promptPresets(): Promise<PromptPreset[]>
      promptExport(): Promise<OperationResult<number>>
      promptImport(): Promise<OperationResult<number>>
      info(): Promise<AppInfo>
      onChanged(callback: () => void): () => void
      sessions: {
        list(): Promise<OperationResult<SessionCatalog>>
        detail(id: string, cursor?: SessionCursor): Promise<OperationResult<SessionDetail>>
        refresh(): Promise<OperationResult<SessionCatalog>>
        export(request: SessionExportRequest): Promise<OperationResult<number>>
        deletePreview(input: { sessionId: string; selectedBlockIds: string[] }): Promise<OperationResult<SessionDeletePreview>>
        delete(request: SessionDeleteRequest): Promise<OperationResult<SessionDeleteResult>>
        backups(sessionId?: string): Promise<OperationResult<SessionBackupSummary[]>>
        restore(operationId: string): Promise<OperationResult<SessionDeleteResult>>
        removeBackup(operationId: string): Promise<OperationResult>
      }
    }
    codexExtensions: {
      info(): Promise<ExtensionInfo>
      skills(): Promise<OperationResult<SkillSummary[]>>
      skillDetail(path: string): Promise<OperationResult<{ path: string; content: string; files: string[] }>>
      setSkillEnabled(path: string, enabled: boolean): Promise<OperationResult>
      importSkill(): Promise<OperationResult<number>>
      exportSkills(paths: string[]): Promise<OperationResult<number>>
      mcp(): Promise<OperationResult<{ servers: McpServerSummary[] }>>
      mcpDetail(name: string): Promise<OperationResult<Record<string, unknown>>>
      setMcpEnabled(name: string, enabled: boolean): Promise<OperationResult>
      saveMcp(name: string, value: unknown): Promise<OperationResult>
      removeMcp(name: string): Promise<OperationResult>
      mcpBackups(): Promise<OperationResult<string[]>>
      mcpDiff(name: string): Promise<OperationResult<{ current: Record<string, unknown>; backup: Record<string, unknown> }>>
      rollbackMcp(name: string): Promise<OperationResult>
      importMcpJson(raw: string): Promise<OperationResult<number>>
      importMcpFile(): Promise<OperationResult<number>>
      exportMcpJson(): Promise<OperationResult<number>>
      exportMcpToml(): Promise<OperationResult<number>>
    }
    codexSkins: {
      status(): Promise<OperationResult<ThemeRuntimeStatus>>
      backup(): Promise<OperationResult<ThemeBackup | null>>
      removeBackup(id: string): Promise<OperationResult<void>>
      apply(id: string): Promise<OperationResult<ThemeBackup | null>>
      restore(id: string): Promise<OperationResult>
      launch(): Promise<OperationResult>
      setMotion(enabled: boolean): Promise<OperationResult>
      list(): Promise<OperationResult<SkinSummary[]>>
      preview(id: string): Promise<OperationResult<SkinPreview>>
      renderPreview(id: string, mode: 'light' | 'dark', view: 'home' | 'task' | 'settings' | 'components', motion_enabled: boolean): Promise<OperationResult<string>>
      export(id: string): Promise<OperationResult<number>>
    }
  }
}

export {}
