import {describe,it,expect,vi} from 'vitest';
vi.mock('electron',()=>({app:{getPath:()=>'.',isPackaged:false},BrowserWindow:class{},shell:{}}));
import {resumeMessage,isGoAhead} from '../../packages/orchestrator/src/resume-message';
import {parseCodeTool} from '../../packages/orchestrator/src/code-tools';
import {activeReads,unchangedRead,workingContext} from '../../packages/orchestrator/src/working-context';
import {handleReport,reference,MAX_REPORT_BYTES} from '../../supabase/functions/dream-gateway/reports';

describe('after a stop',()=>{
 it('passes a plain go-ahead as it is, and asks for an answer to anything else',()=>{
  for(const text of ['continue','Continue.','next','keep going','go ahead','ok'])expect(resumeMessage(text)).toBe(text);
  const asked=resumeMessage('whats taking so long');
  expect(asked).toContain('"whats taking so long"');expect(asked).toMatch(/reply to it in one short note/);expect(isGoAhead('make it shorter')).toBe(false);
  expect(resumeMessage('actually make it 5 minutes')).toMatch(/do that instead of carrying on as before/);
 });
});

describe('tool inputs',()=>{
 it('moves a number past a field\'s bounds to the bound instead of rejecting the call',()=>{
  const read=parseCodeTool('read_file',{path:'context/project.md',limit:5000});expect(read.limit).toBe(400);
  const shots=parseCodeTool('find_shots',{query:'city streets',limit:80});expect(shots.limit).toBe(24);
 });
});

const call=(id:string,name:string,input:any)=>({role:'assistant',content:[{type:'tool_use',id,name,input}]});
const answer=(id:string,result:any)=>({role:'user',content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(result)}]});
describe('reads kept through commands and summaries',()=>{
 const guide={path:'context/editing.md',hash:'h1',text:'how to edit'},cut={path:'cut.py',hash:'c1',text:'print(1)'};
 const history=[call('1','read_file',{path:'context/editing.md'}),answer('1',guide),call('2','read_file',{path:'cut.py'}),answer('2',cut),call('3','run_command',{command:'python cut.py'}),answer('3',{process:{status:'complete'}})];
 it('a command drops reads of the agent\'s own files but keeps the guides',()=>{
  expect(activeReads(history as any).map(r=>r.input.path)).toEqual(['context/editing.md']);
 });
 it('a summary keeps the guides even with no room for other reads',()=>{
  const kept=workingContext(history as any,[],0);expect(kept&&JSON.parse(kept.content).dreamWorkingReads.map((r:any)=>r.input.path)).toEqual(['context/editing.md']);
 });
 it('an unchanged guide read again comes back as a short receipt, a changed one in full',()=>{
  expect(unchangedRead(history as any,{path:'context/editing.md'},guide)).toMatchObject({unchanged:true,hash:'h1'});
  expect(unchangedRead(history as any,{path:'context/editing.md'},{...guide,hash:'h2'})).toEqual({...guide,hash:'h2'});
  expect(unchangedRead(history as any,{path:'cut.py'},cut)).toEqual(cut);
  // The receipt never replaces the full read it points to.
  const after=[...history,call('4','read_file',{path:'context/editing.md'}),answer('4',{unchanged:true,hash:'h1'})];
  expect(activeReads(after as any)[0].result).toEqual(guide);
 });
});

describe('Send log',()=>{
 const ports=(sent=0)=>{const rows:any[]=[];return{rows,ports:{sentToday:async()=>sent,insert:async(row:any)=>{rows.push(row);}}};};
 const log={project:{name:'Exploring Vietnam'},totals:[{model:'gpt-6.1-sol',calls:48,costUsd:.81},{model:'gemini-3.8-flash',calls:20,costUsd:.03}]};
 it('keeps a log with its totals and answers with a reference',async()=>{
  const {rows,ports:p}=ports();const result=await handleReport({turnId:'t1',note:'too slow',appVersion:'0.1.0',log},'user-1',p);
  expect(result.status).toBe(200);expect((result.body as any).reference).toMatch(/^GL-[2-9A-HJ-NP-Z]{6}$/);
  expect(rows[0]).toMatchObject({user_id:'user-1',turn_id:'t1',project:'Exploring Vietnam',note:'too slow',calls:68});expect(rows[0].cost_usd).toBeCloseTo(.84);
 });
 it('refuses an empty log, one too large, and more than 20 a day',async()=>{
  expect((await handleReport({turnId:'t1'},'u',ports().ports)).status).toBe(400);
  expect((await handleReport({turnId:'t1',log:{x:'a'.repeat(MAX_REPORT_BYTES)}},'u',ports().ports)).status).toBe(413);
  expect((await handleReport({turnId:'t1',log},'u',ports(20).ports)).status).toBe(429);
  expect(reference(()=>new Uint8Array([0,1,2,3,4,5]))).toBe('GL-234567');
 });
});
