import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { open_runtime_connection } from './theme_rpc'
import { connect_inspector_theme } from './theme_inspector'
import { PROBE_EXPRESSION } from './vendor/codex-themes/engine/constants'

export interface ThemeTarget { id: string; type: string; url: string; webSocketDebuggerUrl: string }
export interface ThemeConnection { id: string; evaluate<T>(expression: string): Promise<T>; close(): void }
const exec_file = promisify(execFile)
export const THEME_PORT = 9341

// 原始字符串便于核对 PowerShell 表达式；系统解析证书名称，兼容带引号的逗号名称。
export const CODEX_DISCOVERY_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$result=[ordered]@{executable=$null;running=$false;diagnostics=@()}
$packages=@(Get-AppxPackage | Where-Object {$_.Name -match '^OpenAI\.(Codex|ChatGPT)$'} | Sort-Object @{Expression={if($_.Name -eq 'OpenAI.Codex'){0}else{1}}}, @{Expression={$_.Version};Descending=$true})
foreach($package in $packages) {
  try {
    $root=[IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\')+'\'
    $manifest=Get-AppxPackageManifest -Package $package.PackageFullName
    foreach($item in @($manifest.Package.Applications.Application)) {
      $file=[IO.Path]::GetFullPath((Join-Path $root ([string]$item.Executable)))
      if(-not $file.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($file) -notmatch '^(Codex|ChatGPT)\.exe$') { continue }
      if(-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
      $signature=Get-AuthenticodeSignature -LiteralPath $file
      if($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { $result.diagnostics += '安装包可执行文件签名无效'; continue }
      $signer=$signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
      if($signer -notin @('OpenAI OpCo, LLC','OpenAI, LLC','OpenAI')) { $result.diagnostics += '安装包签名发布者不是受支持的 OpenAI 发布者'; continue }
      $result.executable=$file
      $result.running=@(Get-Process -Name Codex,ChatGPT -ErrorAction SilentlyContinue | Where-Object {$_.Path -and $_.Path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)}).Count -gt 0
      break
    }
  } catch { $result.diagnostics += '无法读取安装包清单或签名' }
  if($result.executable) { break }
}
if($packages.Count -eq 0) { $result.diagnostics += '未找到系统登记的 OpenAI.Codex 或 OpenAI.ChatGPT 安装包' }
$result | ConvertTo-Json -Compress
`

export async function discover_codex_installation(): Promise<{ executable: string | null; running: boolean; diagnostics: string[] }> {
  // Windows PowerShell 自行建立模块路径，避免继承 PowerShell 7 的不兼容内置模块。
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
  const { stdout } = await exec_file('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CODEX_DISCOVERY_SCRIPT], { windowsHide: true, timeout: 15000, encoding: 'utf8', env: environment })
  return JSON.parse(stdout.trim())
}

export function validate_theme_target(target: ThemeTarget, port: number): string {
  const page = new URL(target.url), socket = new URL(target.webSocketDebuggerUrl)
  if (target.type !== 'page' || page.protocol !== 'app:' || socket.protocol !== 'ws:' || socket.hostname !== '127.0.0.1' || Number(socket.port) !== port || socket.username || socket.password || !socket.pathname.startsWith('/devtools/page/')) throw Error('拒绝连接未经验证的 Codex 调试目标')
  return socket.href
}

export async function connect_codex_theme(ports?: number[]): Promise<ThemeConnection[]> {
  const allow_inspector = ports === undefined
  ports ??= [THEME_PORT, 9335]
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('本地主题连接端口无效')
    const connected: ThemeConnection[] = []
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500), redirect: 'error' })
      const raw = await response.text()
      if (!response.ok || raw.length > 256000) continue
      const targets: ThemeTarget[] = JSON.parse(raw)
      if (!Array.isArray(targets) || targets.length > 64) continue
      for (const target of targets) {
        let connection: ThemeConnection | undefined
        try {
          connection = await open_runtime_connection(target.id, validate_theme_target(target, port))
          const probe = await connection.evaluate<{ title: string; modeButtonText: string; modeButtonLabel: string; markers: Record<string, boolean> }>(PROBE_EXPRESSION)
          const mode = `${probe.modeButtonText} ${probe.modeButtonLabel}`.trim() || probe.title
          if (!/codex/i.test(mode) || /chatgpt/i.test(mode) || !probe.markers.shell || !probe.markers.sidebar || !probe.markers.main) throw Error('当前窗口不是 Codex 工作界面')
          connected.push(connection)
        } catch { connection?.close() }
      }
      if (connected.length) return connected
    } catch { for (const connection of connected) connection.close() }
  }
  if (allow_inspector) {
    const connections = await connect_inspector_theme()
    if (connections.length) return connections
  }
  throw Error('尚未连接 Codex。点击“连接运行中的 Codex”尝试无重启接入；不会退出、重启或刷新当前客户端。')
}

export async function launch_codex_theme(): Promise<void> {
  try { const connections = await connect_codex_theme(); connections.forEach(connection => connection.close()); return } catch { /* 未连接时继续检查本机安装与进程。 */ }
  if (process.platform !== 'win32') {
    const connections = await connect_inspector_theme(true); connections.forEach(connection => connection.close()); return
  }
  const { executable, running, diagnostics } = await discover_codex_installation()
  if (!executable) throw Error(diagnostics.join('；') || '已找到 Codex 安装包，但没有可用的已签名桌面程序')
  if (running) {
    const connections = await connect_inspector_theme(true); connections.forEach(connection => connection.close()); return
  }
  const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${THEME_PORT}`], { windowsHide: true, detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(Error('Codex 启动失败'))) })
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try { const connections = await connect_codex_theme(); connections.forEach(connection => connection.close()); return }
    catch { await new Promise(resolve => setTimeout(resolve, 500)) }
  }
  throw Error('Codex 已发起启动，但连接尚未就绪。可稍后点击“检测连接”，或连接已运行的客户端。')
}
