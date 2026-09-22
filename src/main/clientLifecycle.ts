import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CODEX_APP_ID = 'OpenAI.Codex_2p2nqsd0c76g0!App'

export interface ProcessInfo { processId: number; name: string; executablePath?: string }
interface RawProcessInfo { ProcessId?: unknown; Name?: unknown; ExecutablePath?: unknown }
export interface RunningClient { processIds: number[]; launcher: { kind: 'appId' | 'executable'; value: string } }

export function normalizeWindowsProcesses(input: unknown): ProcessInfo[] {
  const items = Array.isArray(input) ? input : input ? [input] : []
  return items.flatMap((value) => {
    const item = value as RawProcessInfo
    const processId = Number(item.ProcessId)
    if (!Number.isInteger(processId) || typeof item.Name !== 'string') return []
    return [{ processId, name: item.Name, executablePath: typeof item.ExecutablePath === 'string' ? item.ExecutablePath : undefined }]
  })
}

export function identifyWindowsClient(processes: ProcessInfo[]): RunningClient | undefined {
  const desktop = processes.filter((item) => {
    const name = typeof item.name === 'string' ? item.name.toLowerCase() : ''
    const path = (item.executablePath || '').toLowerCase()
    return name === 'chatgpt.exe' || (name === 'codex.exe' && path.includes('windowsapps\\openai.codex_'))
  })
  if (!desktop.length) return undefined
  const packaged = desktop.some((item) => (item.executablePath || '').toLowerCase().includes('windowsapps\\openai.codex_'))
  const executable = desktop.find((item) => item.executablePath)?.executablePath
  if (!packaged && !executable) return undefined
  return { processIds: [...new Set(desktop.map((item) => item.processId))], launcher: packaged ? { kind: 'appId', value: CODEX_APP_ID } : { kind: 'executable', value: executable! } }
}

export async function confirmClientExit(
  original: RunningClient,
  findClient: () => Promise<RunningClient | undefined>,
  confirmManualExit: (stillRunning: boolean) => Promise<boolean>
): Promise<RunningClient> {
  let stillRunning = false
  while (true) {
    if (!await confirmManualExit(stillRunning)) throw new Error('已取消切换，账号未修改')
    if (!await findClient()) return original
    stillRunning = true
  }
}

async function windowsProcesses(): Promise<ProcessInfo[]> {
  const script = "$items=Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('ChatGPT.exe','Codex.exe')} | Select-Object ProcessId,Name,ExecutablePath; @($items) | ConvertTo-Json -Compress"
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 })
  return normalizeWindowsProcesses(JSON.parse(stdout || '[]'))
}

export async function waitForSafeClientExit(confirmManualExit: (stillRunning: boolean) => Promise<boolean>, options: { warnOnly?: boolean } = {}): Promise<RunningClient | undefined> {
  if (process.platform !== 'win32') return undefined
  const original = identifyWindowsClient(await windowsProcesses())
  if (!original) return undefined
  if (options.warnOnly) {
    if (!await confirmManualExit(true)) throw new Error('已取消操作')
    return original
  }
  return confirmClientExit(original, async () => identifyWindowsClient(await windowsProcesses()), confirmManualExit)
}

export function restartClient(client?: RunningClient): void {
  if (!client || process.platform !== 'win32') return
  const child = client.launcher.kind === 'appId'
    ? spawn('explorer.exe', [`shell:AppsFolder\\${client.launcher.value}`], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(client.launcher.value, [], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}
