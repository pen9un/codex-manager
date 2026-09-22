import { describe, expect, it } from 'vitest'
import { confirmClientExit, identifyWindowsClient, normalizeWindowsProcesses } from '../src/main/clientLifecycle'
describe('desktop client identification', () => {
  it('normalizes PowerShell PascalCase process fields', () => expect(normalizeWindowsProcesses({ ProcessId: 9, Name: 'ChatGPT.exe', ExecutablePath: 'C:\\ChatGPT.exe' })).toEqual([{ processId: 9, name: 'ChatGPT.exe', executablePath: 'C:\\ChatGPT.exe' }]))
  it('recognizes the packaged Codex desktop client', () => { const client = identifyWindowsClient([{ processId: 1, name: 'ChatGPT.exe', executablePath: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0_x64\\app\\ChatGPT.exe' }]); expect(client?.processIds).toEqual([1]); expect(client?.launcher.kind).toBe('appId') })
  it('never targets Codex CLI or IDE extensions', () => expect(identifyWindowsClient([{ processId: 2, name: 'codex.exe', executablePath: 'C:\\Users\\john\\.kiro\\extensions\\openai.chatgpt\\bin\\codex.exe' }])).toBeUndefined())
  it('deduplicates desktop helper process ids', () => expect(identifyWindowsClient([{ processId: 3, name: 'ChatGPT.exe', executablePath: 'C:\\ChatGPT.exe' }, { processId: 3, name: 'ChatGPT.exe', executablePath: 'C:\\ChatGPT.exe' }])?.processIds).toEqual([3]))
  it('waits for a manual exit and never terminates the client itself', async () => {
    const client = { processIds: [1], launcher: { kind: 'appId' as const, value: 'app' } }
    const prompts: boolean[] = []
    let checks = 0
    await expect(confirmClientExit(client, async () => ++checks === 1 ? client : undefined, async (stillRunning) => { prompts.push(stillRunning); return true })).resolves.toBe(client)
    expect(prompts).toEqual([false, true])
  })
  it('cancels without modifying the account when the user is not ready', async () => {
    const client = { processIds: [1], launcher: { kind: 'appId' as const, value: 'app' } }
    await expect(confirmClientExit(client, async () => client, async () => false)).rejects.toThrow('账号未修改')
  })
})
