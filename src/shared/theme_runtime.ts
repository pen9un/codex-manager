export interface ThemeBackup {
  id: string; created_at: string; name: string; windows: number
  theme_name?: string
  available: boolean; unavailable_reason?: string
}
export interface ThemeRuntimeStatus {
  connected: boolean; active_id: string | null; backups: ThemeBackup[]; message: string; motion_enabled: boolean
}
