import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {ProjectDB} from '@dream/project-db';
import {usageCost,modelPrices} from '@dream/config';
import {usageCost as gatewayCost} from '../../supabase/functions/dream-gateway/inference-policy';
import {infer} from '../../packages/agent/src/transport';
import {parseTool} from '../../packages/agent/src/tools';
import {Workspace} from '../../apps/project-service/src/workspace';
import {publishWorkspace} from '../../apps/project-service/src/code-publication';
import type {ProcessResult} from '@dream/contracts';

const config={url:'http://local-fixture',token:'fixture-not-a-secret',accountId:'fixture-account'};
const fixture=(name='Usage')=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-usage-')),name);
const processResult=(id:string):ProcessResult=>({id,status:'complete',exitCode:0,startedAt:'fixture',finishedAt:'fixture',output:'',logPath:'',isolation:'windows-appcontainer',commandHash:id});

it('prices usage exactly like the gateway for every model, both Haiku tiers, cache writes and fallbacks',()=>{
 const usages=[{input_tokens:50000,output_tokens:10000},{input_tokens:2000,cache_read_input_tokens:99000,output_tokens:500},{input_tokens:1000,cache_read_input_tokens:60000,cache_creation_input_tokens:40000,cache_creation:{ephemeral_1h_input_tokens:30000},output_tokens:4000},{input_tokens:10,output_tokens:10,iterations:[{type:'fallback_message',model:'claude-opus-5',input_tokens:100,output_tokens:5},{type:'message',input_tokens:100,output_tokens:50}]}];
 for(const model of Object.keys(modelPrices))for(const usage of usages)expect(usageCost(model,usage)).toBeCloseTo(gatewayCost(model,usage,modelPrices[model]),12);
 expect(usageCost('claude-haiku-5-5',{input_tokens:101000,output_tokens:0})).toBeCloseTo(101000*.5/1e6,12);
});

it('records one cost row per response with its phase, the helper it belongs to and its duration, and publishes it',async()=>{
 const db=fixture();try{const published:any[]=[];
  await infer({db,config,publish:(type,payload)=>published.push({type,payload}),input:{model:'claude-haiku-5-5',system:'Work',messages:[{role:'user',content:'Do it'}],tools:[],turnId:'turn',purpose:'subagent',phase:'task:call-intro',max_tokens:16384}},{fetch:async()=>Response.json({content:[{type:'text',text:'Done'}],stop_reason:'end_turn',usage:{input_tokens:1000,cache_read_input_tokens:4000,output_tokens:300}})});
  const row=db.db.prepare('SELECT * FROM ai_usage').get() as any;
  expect(row).toMatchObject({turn_id:'turn',model:'claude-haiku-5-5',purpose:'subagent',phase:'task:call-intro',parent:'task:call-intro',input_tokens:1000,cache_read:4000,output_tokens:300});
  expect(row.cost_usd).toBeCloseTo(usageCost('claude-haiku-5-5',{input_tokens:1000,cache_read_input_tokens:4000,output_tokens:300}),6);
  expect(published.find(p=>p.type==='ai.usage')?.payload).toMatchObject({purpose:'subagent',outputTokens:300,visibleChars:expect.any(Number),durationMs:expect.any(Number)});
  expect(db.turnUsage('turn')).toMatchObject({calls:1,rows:[expect.objectContaining({owner:'task:call-intro'})]});
 }finally{db.close();}
});

it('stores each activity event as one row and keeps the saved turn summary small',()=>{
 const db=fixture();try{
  db.setMeta('pending_request',JSON.stringify({text:'Edit',turnId:'turn'}));
  for(let n=0;n<200;n++)db.activityEvent('turn',{id:'stream',kind:'commentary',text:'Writing '+n,status:'running'});
  db.activityEvent('turn',{id:'run',kind:'terminal',text:'Command',status:'complete',output:'x'.repeat(20000),detail:'d'.repeat(5000)});
  const rows=db.db.prepare("SELECT id,json FROM activity_events WHERE turn_id='turn'").all() as {id:string;json:string}[];
  expect(rows.map(r=>r.id).sort()).toEqual(['run','stream']);
  const stream=JSON.parse(rows.find(r=>r.id==='stream')!.json),run=JSON.parse(rows.find(r=>r.id==='run')!.json);
  expect(stream).toMatchObject({text:'Writing 199',revision:200,sequence:0});expect(run.output).toHaveLength(4000);expect(run.detail).toHaveLength(1000);
  expect(db.getMeta('turn_activity:turn')).not.toContain('Writing');
  expect(db.turnActivity('turn')?.events?.map(e=>e.id)).toEqual(['stream','run']);
  expect(db.activityPage('turn',1).map(e=>e.id)).toEqual(['stream']);
 }finally{db.close();}
});

it('publishes file changes as hashes and line counts, and reads the text back on demand',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-receipt-')),db=new ProjectDB(root,'Receipt');const ws=new Workspace(db,{run:async()=>{throw new Error('unexpected run');},ffmpeg:'',ffprobe:''},()=>{});
 try{await ws.initialize();const big=Array.from({length:4000},(_,n)=>`export const line${n}=${n};`).join('\n');writeFileSync(join(root,'Workspace/src/big.js'),big);
  const file=join(root,'Workspace','project.json'),doc=JSON.parse(readFileSync(file,'utf8'));doc.timeline.settings.fps=24;writeFileSync(file,JSON.stringify(doc));
  const receipt=await publishWorkspace(db,processResult('first'),'turn','');
  const change=receipt!.files.find(f=>f.path==='src/big.js')!;expect(change).toMatchObject({added:4000,removed:0});expect(change).not.toHaveProperty('after');
  expect(JSON.stringify(receipt).length).toBeLessThan(10_000);
  expect(db.fileDiff(change.beforeHash,change.afterHash).after).toBe(big);
 }finally{db.close();}
});

it('moves events out of saved turns during migration, idempotently',()=>{
 const db=fixture();const folder=db.folder;db.close();
 const raw=new Database(join(folder,'.dream/project.sqlite'));const version=raw.pragma('user_version',{simple:true}) as number;
 raw.exec('DROP TABLE activity_events');raw.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('turn_activity:old',JSON.stringify({steps:[],status:'complete',changes:[],events:[{id:'a',sequence:0,kind:'action',text:'Read',status:'complete'},{id:'p',sequence:1,kind:'changes',text:'Updated',status:'complete',files:[{path:'src/a.js',before:'one',after:'one\ntwo',truncated:false}]}]}));
 // Rewind to just before the activity migration (activity schema, event move, scene errors, message selection, footage
 // interpretations removed).
 raw.pragma(`user_version=${version-5}`);raw.close();
 const reopened=new ProjectDB(folder);try{
  expect(JSON.parse(reopened.getMeta('turn_activity:old')!).events).toBeUndefined();
  const events=reopened.turnActivity('old')!.events!;expect(events.map(e=>e.id)).toEqual(['a','p']);expect(events[1].files![0]).toEqual({path:'src/a.js',added:1,removed:0});
 }finally{reopened.close();}
 const again=new ProjectDB(folder);try{expect(again.turnActivity('old')!.events).toHaveLength(2);}finally{again.close();}
});


it('shortens over-long prose fields instead of failing the tool call, but never code or paths',()=>{
 // Limits the model is not shown never fail a call: a long task title, a long search, numbers past their bounds.
 const todo=parseTool('todo',{tasks:[{id:'cut',title:'t'.repeat(900),status:'running'}]});expect(todo.tasks[0].title.length).toBeLessThanOrEqual(200);
 const find=parseTool('find',{query:'q'.repeat(900),limit:500});expect(find.query.length).toBeLessThanOrEqual(300);expect(find.limit).toBe(24);
 // A quoted choice and a null for an optional field are slips, not errors.
 expect(parseTool('look',{target:'"edit"',source:null})).toMatchObject({target:'edit'});
 // Code and paths are never shortened: an over-long one fails.
 expect(()=>parseTool('write',{path:'p'.repeat(3000),content:'x'})).toThrow(/write input is not valid/);
 expect(parseTool('edit',{path:'project.json',oldText:'a'.repeat(5000),newText:'b'}).oldText).toHaveLength(5000);
});
