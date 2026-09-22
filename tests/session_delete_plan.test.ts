import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSessionFile } from '../src/main/session_parser'
import { plan_session_deletion } from '../src/main/session_delete_plan'
const row=(type:string,payload:unknown)=>JSON.stringify({type,payload})
describe('删除规划与解析器 block 归属',()=>{ it('工具先创建空 AI 块时保持相同 block id',async()=>{ const dir=await mkdtemp(join(tmpdir(),'delete-plan-')); const path=join(dir,'rollout-x.jsonl'); await writeFile(path,[row('response_item',{type:'function_call',call_id:'c',name:'x',arguments:'{}'}),row('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'完成'}]})].join('\n')); const ref={id:'x',path,archived:false}; const parsed=await parseSessionFile(ref); expect(parsed.blocks).toHaveLength(1); const plan=await plan_session_deletion([ref],[parsed.blocks[0].id]); expect(plan.assistantBlockCount).toBe(1); expect(plan.rawRecordCount).toBe(2) }) })
