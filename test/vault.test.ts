import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({app:{getPath:()=>''},safeStorage:{isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString()}}))
import { Vault } from '../src/main/vault'
let dir:string
 afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true})})
describe('vault transactions',()=>{
 it('serializes complete reads and writes and recovers after failure',async()=>{
  dir=await mkdtemp(join(tmpdir(),'cam-vault-test-'));const vault=new Vault(join(dir,'test.vault'))
  await Promise.all(Array.from({length:20},()=>vault.update(async data=>{await new Promise(resolve=>setTimeout(resolve,1));data.settings.refreshMinutes+=1})))
  expect((await vault.read()).settings.refreshMinutes).toBe(25)
  await expect(vault.update(()=>{throw new Error('cancel')})).rejects.toThrow('cancel')
  await vault.update(data=>{data.settings.autoRefresh=false})
  expect((await vault.read()).settings.autoRefresh).toBe(false)
 })
})
