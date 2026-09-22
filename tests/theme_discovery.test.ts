import { execFile as real_exec_file } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import * as connection from '../src/main/theme_connection'

const exec_file = promisify(real_exec_file)
// 在真实 PowerShell 中执行生产发现脚本，仅替换系统查询，避免启动或关闭客户端。
async function discover_fixture(signer = 'OpenAI OpCo, LLC', status = 'Valid', executable = 'app/ChatGPT.exe', running = true, package_name = 'OpenAI.Codex') {
  const fixture = `
function Get-AppxPackage { [pscustomobject]@{Name='${package_name}';PackageFullName='CodexFixture';InstallLocation='C:\\CodexFixture';Version=[version]'26.908.4834.0'} }
function Get-AppxPackageManifest { [pscustomobject]@{Package=[pscustomobject]@{Applications=[pscustomobject]@{Application=@([pscustomobject]@{Executable='${executable}'})}}} }
function Test-Path { return $true }
function Get-AuthenticodeSignature {
  $certificate=[pscustomobject]@{}; $certificate | Add-Member ScriptMethod GetNameInfo { return '${signer}' }
  [pscustomobject]@{Status='${status}';SignerCertificate=$certificate}
}
function Get-Process { ${running ? "[pscustomobject]@{Path='C:\\CodexFixture\\app\\ChatGPT.exe'}" : ''} }
`
  const { stdout } = await exec_file('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', fixture + connection.CODEX_DISCOVERY_SCRIPT], { windowsHide: true, timeout: 15000 })
  return JSON.parse(stdout.trim())
}

// 此集成检查执行系统自带的 Windows PowerShell，不要求其他平台安装它。
describe.runIf(process.platform === 'win32')('Windows Codex 安装发现', () => {
  it('识别官方包的 ChatGPT.exe 与包含逗号的 OpenAI 证书名称，并报告运行状态', async () => {
    expect(await discover_fixture()).toMatchObject({ executable: 'C:\\CodexFixture\\app\\ChatGPT.exe', running: true })
  }, 20000)
  it('保留签名验证，拒绝无效签名与相似发布者名称', async () => {
    for (const [name, status] of [['OpenAI OpCo, LLC', 'HashMismatch'], ['OpenAI Fake, LLC', 'Valid']]) {
      expect((await discover_fixture(name, status)).executable).toBeNull()
    }
  }, 20000)
  it('拒绝包目录外的清单路径及非目标安装包', async () => {
    expect((await discover_fixture('OpenAI OpCo, LLC', 'Valid', '../ChatGPT.exe')).executable).toBeNull()
    expect((await discover_fixture('OpenAI OpCo, LLC', 'Valid', 'app/ChatGPT.exe', false, 'OpenAIxCodex')).executable).toBeNull()
  }, 20000)
  it('未运行的正确安装包可以供启动流程使用', async () => {
    expect(await discover_fixture('OpenAI OpCo, LLC', 'Valid', 'app/ChatGPT.exe', false)).toMatchObject({ executable: 'C:\\CodexFixture\\app\\ChatGPT.exe', running: false })
  }, 20000)
})
