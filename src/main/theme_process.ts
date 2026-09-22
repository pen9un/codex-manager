import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readlink, readdir, realpath, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, isAbsolute } from 'node:path'
import { constants } from 'node:os'

export type WakeProof = 'windows-handler' | 'posix-signal' | 'electron-fuse' | null
export interface ThemeProcess { pid: number; executable: string; identity: string; ports: number[]; wake_proof: WakeProof }
const exec_file = promisify(execFile)

export function has_signal_handler(mask: string, signal: number): boolean {
  return /^[0-9a-f]{1,16}$/i.test(mask) && signal > 0 && signal <= 64 && (BigInt(`0x${mask}`) & (1n << BigInt(signal - 1))) !== 0n
}

export function can_wake_process(platform: string, proof: WakeProof): boolean {
  return platform === 'win32' && proof === 'windows-handler' || platform === 'linux' && proof === 'posix-signal' || platform === 'darwin' && proof === 'electron-fuse'
}

const windows_process_script = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$roots=@(Get-AppxPackage | Where-Object {$_.Name -eq 'OpenAI.Codex'} | ForEach-Object {[IO.Path]::GetFullPath($_.InstallLocation).TrimEnd('\')+'\'})
$listeners=@(netstat -ano | ForEach-Object {if($_ -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {[pscustomobject]@{address=$matches[1].Trim('[',']');port=[int]$matches[2];owner=[int]$matches[3]}}})
$items=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' OR Name='Codex.exe'" | Where-Object {$_.CommandLine -notmatch '--type='})
$result=@(foreach($item in $items) {
  $file=$item.ExecutablePath
  if(-not $file -or -not ($roots | Where-Object {$file.StartsWith($_,[StringComparison]::OrdinalIgnoreCase)})) {continue}
  $signature=Get-AuthenticodeSignature -LiteralPath $file
  if($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {continue}
  $signer=$signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
  if($signer -notin @('OpenAI OpCo, LLC','OpenAI, LLC','OpenAI')) {continue}
  $proof=$null
  try { $mapping=[IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting(('node-debug-handler-'+$item.ProcessId),[IO.MemoryMappedFiles.MemoryMappedFileRights]::Read);$mapping.Dispose();$proof='windows-handler' } catch {}
  $ports=@($listeners | Where-Object {$_.owner -eq $item.ProcessId -and $_.address -in @('127.0.0.1','::1')} | Select-Object -ExpandProperty port -Unique)
  [ordered]@{pid=[int]$item.ProcessId;executable=$file;identity=([string]$item.ProcessId+':'+$item.CreationDate.ToUniversalTime().Ticks);ports=$ports;wake_proof=$proof}
})
ConvertTo-Json -InputObject $result -Compress
`

async function linux_ports(pid: number): Promise<number[]> {
  const sockets = new Set(await Promise.all((await readdir(`/proc/${pid}/fd`)).map(async name => {
    try { return await readlink(`/proc/${pid}/fd/${name}`) } catch { return '' }
  })))
  const ports: number[] = []
  for (const name of ['tcp', 'tcp6']) {
    const source = await readFile(`/proc/${pid}/net/${name}`, 'utf8')
    for (const line of source.trim().split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/), [address, port] = fields[1].split(':')
      if (fields[3] === '0A' && sockets.has(`socket:[${fields[9]}]`) && ['0100007F', '00000000000000000000000001000000'].includes(address)) ports.push(parseInt(port, 16))
    }
  }
  return [...new Set(ports)]
}

// 标准 Electron 的调试开关可以证明其初始化路径；没有标记的 Owl 不能据此唤醒。
export async function has_electron_wake_fuse(executable: string): Promise<boolean> {
  const marker = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
  let carry = Buffer.alloc(0), read_size = 0, last_marker = -1, found = false
  for await (const chunk of createReadStream(executable, { highWaterMark: 512 * 1024 })) {
    const bytes = Buffer.concat([carry, chunk as Buffer]), base = read_size - carry.length
    read_size += (chunk as Buffer).length
    for (let index = bytes.indexOf(marker); index >= 0; index = bytes.indexOf(marker, index + 1)) {
      if (base + index <= last_marker || bytes.length < index + marker.length + 6) continue
      last_marker = base + index; found = true
      // 通用二进制可能有多个架构切片；必须全部允许，不能只读取第一份开关。
      if (bytes[index + marker.length] !== 1 || bytes[index + marker.length + 1] < 4 || bytes[index + marker.length + 5] !== 49) return false
    }
    carry = bytes.subarray(Math.max(0, bytes.length - marker.length - 16))
  }
  const trailing_marker = carry.indexOf(marker)
  return found && (trailing_marker < 0 || read_size - carry.length + trailing_marker <= last_marker)
}

async function unix_processes(read_wake_proof: boolean): Promise<ThemeProcess[]> {
  const platform = process.platform
  const { stdout } = await exec_file('ps', ['-axo', 'pid=,uid=,comm='], { timeout: 5000 })
  const results: ThemeProcess[] = []
  const configured = process.env.CODEX_DESKTOP_EXECUTABLE
  if (platform === 'linux' && configured && !isAbsolute(configured)) throw Error('CODEX_DESKTOP_EXECUTABLE 必须是 Codex 桌面程序的绝对路径')
  const trusted_linux_path = platform === 'linux' && configured ? await realpath(configured) : null
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match || Number(match[2]) !== process.getuid?.()) continue
    const pid = Number(match[1])
    if (pid === process.pid) continue
    try {
      if (platform === 'linux') {
        if (!trusted_linux_path) continue
        const executable = await readlink(`/proc/${pid}/exe`)
        if (executable !== trusted_linux_path) continue
        const args = await readFile(`/proc/${pid}/cmdline`, 'utf8')
        if (args.includes('--type=')) continue
        await access(join(dirname(executable), 'resources', 'app.asar'))
        const status = await readFile(`/proc/${pid}/status`, 'utf8')
        const mask = status.match(/^SigCgt:\s*([0-9a-f]+)$/im)?.[1] || ''
        const stats = await readFile(`/proc/${pid}/stat`, 'utf8')
        const started = stats.slice(stats.lastIndexOf(')') + 2).split(' ')[19]
        results.push({ pid, executable, identity: `${pid}:${started}`, ports: await linux_ports(pid), wake_proof: has_signal_handler(mask, constants.signals.SIGUSR1) ? 'posix-signal' : null })
      } else {
        const executable = match[3]
        if (!/\/Codex\.app\/Contents\/MacOS\/Codex$/.test(executable)) continue
        const bundle = executable.slice(0, executable.indexOf('/Contents/MacOS/'))
        const { stdout: bundle_id } = await exec_file('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(bundle, 'Contents/Info.plist')])
        if (bundle_id.trim() !== 'com.openai.codex') continue
        await exec_file('/usr/bin/codesign', ['--verify', '--strict', bundle])
        const { stderr: signature } = await exec_file('/usr/bin/codesign', ['-dv', '--verbose=4', bundle])
        if (!/^Authority=Developer ID Application: OpenAI(?: OpCo, LLC|, LLC|, L\.L\.C\.)? \([A-Z0-9]+\)$/m.test(signature)) continue
        const { stdout: started } = await exec_file('ps', ['-p', String(pid), '-o', 'lstart='])
        const { stdout: listeners } = await exec_file('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn']).catch(() => ({ stdout: '' }))
        const ports = [...listeners.matchAll(/^n(?:127\.0\.0\.1|\[::1\]):(\d+)$/gm)].map(item => Number(item[1]))
        // Electron 框架中的 fuse 才是 macOS 应用的实际开关，启动器没有该标记。
        const framework = join(bundle, 'Contents/Frameworks/Electron Framework.framework/Electron Framework')
        const proof = read_wake_proof && await has_electron_wake_fuse(framework).catch(() => false)
        results.push({ pid, executable, identity: `${pid}:${started.trim()}`, ports, wake_proof: proof ? 'electron-fuse' : null })
      }
    } catch { /* 无法验证的进程保持原样。 */ }
  }
  return results
}

export async function discover_theme_processes(read_wake_proof = false): Promise<ThemeProcess[]> {
  if (process.platform === 'win32') {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
    const { stdout } = await exec_file('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windows_process_script], { windowsHide: true, timeout: 20000, encoding: 'utf8', env })
    const result = JSON.parse(stdout.trim())
    return Array.isArray(result) ? result : []
  }
  if (process.platform === 'darwin' || process.platform === 'linux') return unix_processes(read_wake_proof)
  return []
}

export async function wake_theme_process(candidate: ThemeProcess): Promise<void> {
  const current = (await discover_theme_processes(true)).find(item => item.identity === candidate.identity && item.executable === candidate.executable)
  if (!current || !can_wake_process(process.platform, current.wake_proof)) throw Error('当前 Codex 运行时没有可验证的无重启调试唤醒入口，已保留原进程')
  if (process.platform === 'win32') {
    // 独立助手限制内部唤醒调用的等待时间，避免阻塞管理器主线程。
    await exec_file(process.execPath, ['-e', 'process._debugProcess(Number(process.argv[1]))', String(current.pid)], { windowsHide: true, timeout: 5000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  } else process.kill(current.pid, 'SIGUSR1')
}
