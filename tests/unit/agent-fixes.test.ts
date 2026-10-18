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

describe('replies',()=>{
 it('never tell the user about modes or that they cannot edit',async()=>{
  const {modeNote}=await import('../../packages/orchestrator/src/code-agent');
  const reply=modeNote('readonly',false);
  expect(reply).not.toMatch(/Current mode|in this mode|unavailable/);expect(reply).toMatch(/never mention modes/);expect(reply).toMatch(/last edit is finished/);
  expect(()=>parseCodeTool('write_file',{path:'a.txt',content:'x'},true)).toThrow(/not offered.*Do not tell the user you cannot edit/);
 });
});

describe('what a look at the edit tells the agent',()=>{
 it('names a scene that crashed, what scenes printed, and a frame with nothing drawn',async()=>{
  const {frameFindings,flatFrame}=await import('../../apps/project-service/src/edit-view');
  const flat={mean:'#f4ecd8',grid:Array(9).fill('#f4ecd8')},drawn={mean:'#c8b48a',grid:['#f4ecd8','#30302c','#f4ecd8','#f4ecd8','#a03020','#f4ecd8','#f4ecd8','#f4ecd8','#f4ecd8']};
  expect(flatFrame(flat)).toBe(true);expect(flatFrame(drawn)).toBe(false);
  const found=frameFindings({labels:['4.2s','not drawn: plan-stroll (Scene plan-stroll: inputRange must be strictly monotonically increasing)','console plan-stroll: fade 18 28 5 13'],stats:flat});
  expect(found.notDrawn?.[0]).toContain('inputRange must be strictly monotonically increasing');expect(found.console).toEqual(['plan-stroll: fade 18 28 5 13']);expect(found.flat).toMatch(/nothing is drawn/);
  expect(frameFindings({labels:['1s'],stats:drawn})).toEqual({});
 });
});

describe('code errors come with their code',()=>{
 it('shows the lines around each file and line an error names, from compile errors, tracebacks and stacks',async()=>{
  const {mkdtempSync,mkdirSync,writeFileSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
  const {codeContext}=await import('../../apps/project-service/src/code-context');
  const root=mkdtempSync(join(tmpdir(),'gumbo-code-'));mkdirSync(join(root,'src'));mkdirSync(join(root,'node_modules'));
  writeFileSync(join(root,'src','Paper.tsx'),Array.from({length:12},(_,n)=>n===6?'  const o=interpolate(frame,[18,28,5,13],[0,1,1,0]);':`// line ${n+1}`).join('\n'));
  writeFileSync(join(root,'cut.py'),'import json\nclips=json.load(open("p.json"))\nprint(clips["missing"])\n');
  const [paper]=codeContext(root,'The scene code does not compile:\nsrc/Paper.tsx:7:13 inputRange must be strictly monotonically increasing');
  expect(paper).toMatchObject({file:'src/Paper.tsx',line:7,column:13});expect(paper.code).toContain('> 7 |   const o=interpolate(frame,[18,28,5,13]');expect(paper.code).toContain('^');expect(paper.code).toContain('// line 5');
  const [python]=codeContext(root,`Traceback (most recent call last):\n  File "${join(root,'cut.py')}", line 3, in <module>\nKeyError: 'missing'`);
  expect(python).toMatchObject({file:'cut.py',line:3});expect(python.code).toContain('> 3 | print(clips["missing"])');
  // Outside the workspace, packages and missing files give nothing.
  expect(codeContext(root,'C:/Windows/win.ini:1 and node_modules/x/index.js:2 and src/Gone.tsx:4')).toEqual([]);
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
