import {it,expect} from 'vitest';
import {requestBody} from '../../packages/orchestrator/src/inference';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {compactConversation,executeHistoryTool,boundedToolResult,conversationBytes} from '../../packages/orchestrator/src/conversation';
import {budgetRequest} from '../../packages/orchestrator/src/context-budget';
import {activeReads} from '../../packages/orchestrator/src/working-context';

it('preserves full current source facts through compaction and replaces redundant reads',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-working-facts-')));try{
  const messages:any[]=[{role:'user',content:'Caption and align the voiceover.'}];
  for(let n=0;n<45;n++){const assetId=n%2?'video':'voice';messages.push({role:'assistant',content:[{type:'tool_use',id:'read'+n,name:'read_transcript',input:{assetId,limit:100,progress:'Read timing '+n}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'read'+n,content:JSON.stringify({assetId,revision:'current',words:Array.from({length:58},(_,i)=>({id:assetId+i,text:'word'+i,start:i*.3,end:i*.3+.2})),totalWords:58})}]});}
  messages.push({role:'assistant',content:[{type:'tool_use',id:'schema',name:'read_file',input:{path:'context/project-schema.json',startLine:1,limit:200}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'schema',content:JSON.stringify({hash:'current-schema',text:'FULL_SCHEMA '+'.'.repeat(16000)})}]});
  const view=compactConversation(db,'turn',messages,40000,true),facts=activeReads(view);
  expect(facts.find(read=>read.input.assetId==='voice')?.result.words).toHaveLength(58);expect(facts.find(read=>read.input.assetId==='video')?.result.words).toHaveLength(58);expect(facts.find(read=>read.tool==='read_file')?.result.text).toContain('FULL_SCHEMA');expect(facts).toHaveLength(3);expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(messages).length*.3);
 }finally{db.close();}
});

it('retains completed transcript and schema reads after a large initial video gallery',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-read-loop-')));try{
  const gallery={role:'user',dreamSource:'media',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'a'.repeat(400000)}}]};
  const messages:any[]=[{role:'user',content:'Caption this voiceover and match it to the video.'},gallery];
  for(let i=0;i<8;i++)messages.push({role:'assistant',content:[{type:'tool_use',id:'read'+i,name:i%2?'read_file':'read_transcript',input:{assetId:'voice'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'read'+i,content:JSON.stringify({words:'timed-word '.repeat(250),complete:true})}]});
  expect(conversationBytes(messages)).toBeLessThan(100000);
  expect(compactConversation(db,'turn',messages,100000,true)).toEqual(messages);
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.context_compacted'").get()).toEqual({n:0});
 }finally{db.close();}
});

it('keeps newly inspected images in the next provider request even when base64 exceeds the byte compaction target',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-fresh-eyes-')),'Fresh evidence');try{
  const content=Array.from({length:16},()=>({type:'image',source:{type:'base64',media_type:'image/jpeg',data:'a'.repeat(40000)}}));
  const messages=[{role:'user',content:'Inspect this source sequence.'},{role:'assistant',content:[{type:'tool_use',id:'inspect',name:'inspect_footage',input:{assetId:'a',startSec:0,endSec:8}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'inspect',content}]}];
  const request=budgetRequest(db,{model:'claude-sonnet-5-5',purpose:'routine',system:'x'.repeat(24000),messages,tools:[],max_tokens:8192});
  expect(request.target).toBe(180000);expect(request.messages.at(-1)).toEqual(messages.at(-1));expect(request.messages.at(-2)).toEqual(messages.at(-2));
 }finally{db.close();}
});

it('archives oversized completed exchanges and exposes exact pages for oversized tool results',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-oversized-result-')),'Oversized');try{
  const tool={type:'tool_use',id:'large',name:'get_score',input:{revisionId:'score'}},result={type:'tool_result',tool_use_id:'large',content:'saved-note '.repeat(20000)};
  const bounded=boundedToolResult(db,'turn',tool,result),reference=JSON.parse(bounded.content);expect(reference.partial).toBe(true);expect(bounded.content.length).toBeLessThan(5000);
  const page=executeHistoryTool(db,'turn','read_execution',{id:reference.executionId,limit:1000}) as any;expect(page.text).toContain('saved-note');expect(page.nextOffset).toBe(1000);
  const original=[{role:'user',content:'Preserve the original voice.'},{role:'assistant',content:[{...tool,input:{source:'x'.repeat(500000)}}]},{role:'user',content:[{...result,content:'Saved.'}]}];
  const view=compactConversation(db,'turn',original,50000);expect(JSON.stringify(view).length).toBeLessThan(50000);expect(view[0]).toEqual(original[0]);expect(original[1].content).toEqual([{...tool,input:{source:'x'.repeat(500000)}}]);
 }finally{db.close();}
});

it('bounds a long multimodal conversation without losing instructions, tool pairing, or local source results',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-context-')),'Context');try{
  const messages:any[]=[{role:'user',content:'Build an orbital animation. Preserve the uploaded voice and use only original music.'}];
  for(let i=0;i<60;i++){
   messages.push({role:'assistant',content:[{type:'thinking',thinking:'private reasoning',signature:'signed-'+i},{type:'tool_use',id:'call-'+i,name:'create_visual',input:{code:'const scene='+i+';'+'.'.repeat(15000)}}]});
   messages.push({role:'user',content:[{type:'tool_result',tool_use_id:'call-'+i,content:[{type:'text',text:JSON.stringify({assetId:'asset-'+i,revisionId:'rev-'+i,versionId:'version-'+i})},{type:'image',source:{type:'base64',media_type:'image/png',data:'a'.repeat(20000)}}]}]});
   if(i===20)messages.push({role:'user',dreamSource:'direction',content:'Make the titles ivory, never red.'});
   if(i===30)messages.push({role:'user',dreamSource:'snapshot',content:'Old snapshot: '+'.'.repeat(20000)});
  }
  const original=JSON.stringify(messages),view=compactConversation(db,'turn',messages,120000);
  expect(JSON.stringify(view).length).toBeLessThan(original.length*.15);expect(JSON.stringify(messages)).toBe(original);
  expect(view[0]).toEqual(messages[0]);expect(JSON.stringify(view)).toContain('Make the titles ivory, never red.');expect(JSON.stringify(view)).not.toContain('Old snapshot');
  expect(view.at(-2)).toEqual(messages.at(-2));expect(view.at(-1)).toEqual(messages.at(-1));expect(JSON.stringify(view)).not.toContain('dreamSource');
  for(let i=0;i<view.length;i++)if(view[i].role==='assistant')for(const block of view[i].content)if(block.type==='tool_use')expect(view[i+1].content.some((r:any)=>r.type==='tool_result'&&r.tool_use_id===block.id)).toBe(true);
  const listed=executeHistoryTool(db,'turn','list_execution_history',{limit:20}) as any;expect(listed.entries.length).toBe(20);expect(listed.nextOffset).toBe(20);
  const entry=listed.entries.find((e:any)=>e.toolCallId==='call-0');const first=executeHistoryTool(db,'turn','read_execution',{id:entry.id,limit:1000}) as any;expect(first.text).toContain('const scene=0');expect(first.nextOffset).toBe(1000);expect(first.text).not.toContain('base64');
  expect(()=>executeHistoryTool(db,'different-turn','read_execution',{id:entry.id})).toThrow('current turn');
  const count=Number((db.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'context:%'").get() as {n:number}).n);compactConversation(db,'turn',messages,120000);expect(Number((db.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'context:%'").get() as {n:number}).n)).toBe(count);
 }finally{db.close();}
});

it('keeps an unfinished or latest signed exchange unchanged instead of breaking provider protocol to meet a size target',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-context-latest-')),'Latest');try{
  const messages=[{role:'user',content:'Goal'},{role:'assistant',content:[{type:'thinking',thinking:'signed content',signature:'must-stay'},{type:'tool_use',id:'active',name:'get_project',input:{}}]}];
  expect(compactConversation(db,'turn',messages,10)).toEqual(messages);
 }finally{db.close();}
});

it('compacts a 30-step Haiku worker at most twice and never sends it more than 96K tokens',async()=>{
 const {infer}=await import('../../packages/orchestrator/src/inference');const {estimateTokens}=await import('../../packages/orchestrator/src/context-budget');
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-haiku-worker-')),'Worker');try{
  const sizes:number[]=[];let counts=0;const real=(body:any)=>Math.round(estimateTokens({system:body.system,messages:body.messages,tools:body.tools})*.9);
  const fetcher:typeof fetch=async(url,init)=>{const body=requestBody(init?.body);if(String(url).endsWith('/count-tokens')){counts++;return Response.json({input_tokens:real(body)});}const tokens=real(body);sizes.push(tokens);return Response.json({content:[{type:'tool_use',id:'read'+sizes.length,name:'read_file',input:{path:'src/shot'+sizes.length+'.tsx'}}],stop_reason:'tool_use',usage:{input_tokens:tokens,output_tokens:200}});};
  const messages:any[]=[{role:'user',content:'Build the seven shots.'}];
  for(let step=0;step<30;step++){
   const response=await infer({db,config:{url:'http://local-fixture',token:'fixture'},resume:0,input:{model:'claude-haiku-5-5',system:'Worker',messages,tools:[],turnId:'turn',purpose:'worker',phase:'main:worker:call:shots',max_tokens:16384}},{fetch:fetcher});
   messages.push({role:'assistant',content:response.content},{role:'user',content:[{type:'tool_result',tool_use_id:response.content[0].id,content:`// shot ${step}\n`+'export const frame=interpolate(f,[0,30],[0,1]);\n'.repeat(300)}]});
  }
  expect(sizes).toHaveLength(30);expect(Math.max(...sizes)).toBeLessThanOrEqual(96000);
  const compactions=(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.context_compacted'").get() as {n:number}).n;
  expect(compactions).toBeGreaterThan(0);expect(compactions).toBeLessThanOrEqual(2);expect(counts).toBeLessThan(10);
 }finally{db.close();}
});
