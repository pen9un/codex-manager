import sourcedPrompts from "./vendor/prompt-sources.json"
export type AccountStatus = 'active' | 'valid' | 'expired' | 'unknown' | 'error'
export type ViewMode = 'cards' | 'list'
export type AccountSort = 'remaining' | 'createdAt' | 'subscriptionExpiresAt'
export type ThemeMode = 'light' | 'dark' | 'system' | 'high-contrast'

export interface UsageWindow {
  usedPercent: number
  windowSeconds?: number
  resetAfterSeconds?: number
  resetsAt?: number
}

export interface AccountUsage {
  primary?: UsageWindow
  secondary?: UsageWindow
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: number | string }
  planType?: string
  fetchedAt: string
}

export interface AccountProfile {
  authProvider?: string
  emailVerified?: boolean
  organizationTitle?: string
  organizationRole?: string
  computeResidency?: string
}

export interface AppSettings {
  viewMode: ViewMode
  autoRefresh: boolean
  refreshMinutes: number
  proxyEnabled: boolean
  proxyUrl: string
  minimizeToTray: boolean
  startAtLogin: boolean
  sidebarCollapsed: boolean
  accountSort: AccountSort
  themeMode: ThemeMode
}
export interface PromptVersion { id: string; content: string; createdAt: string }
export interface PromptPreset { id: string; name: string; description: string; content: string; source?: string; sourceUrl?: string; sourceWarning?: string; scenario?: string; constraints?: string[]; outputRequirements?: string[]; riskBoundary?: string; stars?: number; checkedAt?: string; license?: string; revision?: string }
export interface PromptConfig { content: string; original: string; history: PromptVersion[] }
// 默认内容与模板正文均为固定版本的上游原文，已有用户内容保持不变。
export const DEFAULT_PROMPT = sourcedPrompts[0].content
export const PROMPT_PRESETS: PromptPreset[] = sourcedPrompts

export const DEFAULT_SETTINGS: AppSettings = {
  viewMode: 'cards', autoRefresh: true, refreshMinutes: 5,
  proxyEnabled: false, proxyUrl: '', minimizeToTray: true, startAtLogin: false, sidebarCollapsed: false,
  accountSort: 'remaining', themeMode: 'light'
}

export interface AccountSummary {
  id: string; email: string; planType: string; status: AccountStatus
  expiresAt?: string; subscriptionExpiresAt?: string; isActive: boolean
  createdAt: string; updatedAt: string; lastError?: string; usage?: AccountUsage
  profile?: AccountProfile
}

export interface AccountCredential {
  id: string; email: string; planType: string; accessToken: string; idToken: string
  refreshToken: string; accountId: string; clientId?: string; expiresAt?: string
  subscriptionExpiresAt?: string; createdAt: string; updatedAt: string
  lastError?: string; usage?: AccountUsage
  profile?: AccountProfile
}

export interface OperationResult<T = undefined> { success: boolean; data?: T; error?: string }
export interface AccountImportRow {
  index: number
  label: string
  account_id?: string
  status: 'new' | 'update' | 'skipped'
  reason?: string
}
export interface AccountImportResult { added: number; updated: number; skipped: number }
export interface AccountImportPreview extends AccountImportResult { preview_id: string; rows: AccountImportRow[] }
export interface AppInfo { authPath: string; configPath: string; encryptionAvailable: boolean }

export type ExtensionScope = 'user' | 'project' | 'admin' | 'system'
export interface SkillSummary { id: string; name: string; description: string; path: string; scope: ExtensionScope; enabled: boolean; valid: boolean; updatedAt: string }
export interface McpServerSummary { name: string; transport: 'stdio' | 'http'; enabled: boolean; command?: string; url?: string; tools?: string[]; disabledTools?: string[]; approvalMode?: 'auto' | 'prompt' | 'writes' | 'approve'; startupTimeoutSec?: number; toolTimeoutSec?: number; source: 'config' | 'project' }
export interface ExtensionInfo { configPath: string; skillRoots: Array<{ path: string; scope: ExtensionScope }> }

export type SessionRole = 'user' | 'assistant' | 'system' | 'developer' | 'reasoning' | 'unknown'
export type SessionExportScope = 'user' | 'conversation' | 'with_tools' | 'raw'

export interface SessionFileRef { id: string; path: string; archived: boolean }
export interface SessionToolBlock { id: string; kind: 'call' | 'result'; name?: string; input?: string; result?: string; rawRecordIndexes: number[] }
export interface SessionRawRecord { line: number; timestamp?: string; type?: string; value: unknown; raw?: string; turnId?: string; sourceFile?: string }
export interface SessionMessageBlock {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  text: string
  timestamp?: string
  tools: SessionToolBlock[]
  rawRecordIndexes: number[]
}
export interface SessionDiagnostics { malformedLines: number; ignoredRecords: number; totalLines: number }
export interface SessionSummary {
  id: string
  title: string
  filePath: string
  projectPath?: string
  projectName?: string
  startedAt?: string
  updatedAt?: string
  messageCount: number
  messageCountKnown?: boolean
  archived: boolean
  fileSize: number
  diagnostics: SessionDiagnostics
  projectId?: string
  preview?: string
  fileCount?: number
}
export interface SessionProjectSummary { id: string; name: string; path?: string; sessionCount: number; updatedAt?: string }
export interface SessionCursor { fileIndex: number; offset: number; line: number; turnId?: string }
export interface SessionDetail { summary: SessionSummary; blocks: SessionMessageBlock[]; rawRecords: SessionRawRecord[]; nextCursor?: SessionCursor }
export interface SessionCatalog { projects: SessionProjectSummary[]; sessions: SessionSummary[]; sourcePath?: string; warnings?: string[] }
export interface SessionExportRequest {
  scope: SessionExportScope
  projectId?: string
  sessionIds?: string[]
  selectedBlockIds?: Record<string, string[]>
}

export interface SessionDeleteRequest {
  sessionId: string
  selectedBlockIds: string[]
  previewToken: string
}

export interface SessionDeletePreview {
  sessionId: string
  previewToken: string
  turnIds: string[]
  userBlockCount: number
  assistantBlockCount: number
  toolRecordCount: number
  rawRecordCount: number
  fileCount: number
  warnings: string[]
  expiresAt: number
}

export interface SessionDeleteResult {
  operationId: string
  deletedTurnCount: number
  deletedRecordCount: number
  backupId: string
}

export interface SessionBackupSummary {
  id: string
  sessionId: string
  createdAt: string
  fileCount: number
  deletedTurnCount: number
  restorable: boolean
}
