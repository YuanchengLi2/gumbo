import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models} from '@dream/config';
import {Director,parseCodeRoute} from '../../packages/orchestrator/src/code-director';
import {routeCodeRequest} from '../../packages/orchestrator/src/routing';
import {inferencePolicy} from '../../supabase/functions/dream-gateway/inference-policy';
import {parseCodeTool,allowedTools} from '../../packages/orchestrator/src/code-tools';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-orchestration-')));
const text=(value:string)=>({content:[{type:'text',text:value}],stop_reason:'end_turn',usage:{}});
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const route=(value:Record<string,unknown>)=>text(JSON.stringify({complexity:'normal',reason:'Fixture route',approvalQuote:null,...value}));
const workspaceFor=(db:ProjectDB,executed:string[]=[])=>({initialize:async()=>{},context:()=>({}),execute:async(name:string)=>{executed.push(name);return name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true};}});
type Call={purpose:string;model:string;phase:string;tools:string[];messages:string};
const pending=(db:ProjectDB)=>JSON.parse(db.getMeta('pending_request')!).turnId as string;

it('routes text deliverables to a reply, continues only stopped work, and lets the provider schema say continue',()=>{
 expect(routeCodeRequest('wait can you make a script for it first','auto',true).route).toBe('question');
 expect(routeCodeRequest('write a script for a 20 second ad','auto').route).toBe('question');
 expect(routeCodeRequest('come up with ideas then build it','auto').route).toBe('local');
 expect(routeCodeRequest('can you create a minecraft animated short explaining what claude is, thinking of a script under 23 seconds, make it look really good','auto').route).toBe('local');
 expect(routeCodeRequest('continue','auto',true).route).toBe('continue');expect(routeCodeRequest('ok, keep going','auto',true).route).toBe('continue');
 expect(routeCodeRequest('continue','auto',false).route).toBe('local');expect(routeCodeRequest('Trim the first clip to 3 seconds','auto').complexity).toBe('simple');
 const parsed=(interrupted:boolean)=>parseCodeRoute({route:'continue',intelligence:'haiku',complexity:'normal',reason:'More',approvalQuote:null},'keep going','auto',interrupted).route;
 expect(parsed(true)).toBe('continue');expect(parsed(false)).toBe('local');
 expect((inferencePolicy(models.agent,'routing').output_config as any).format.schema.properties.route.enum).toContain('continue');
});

it('answers a request for a script after a stop as a new turn, and continues the stopped request only when asked',async()=>{
 const db=fixture(),calls:Call[]=[];let failEdit=true;try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspaceFor(db));
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:JSON.stringify(messages)});
   if(purpose==='routing')return JSON.parse((messages as any)[0].content).request.startsWith('wait')?route({route:'question',intelligence:'opus',reason:'Wants the script first'}):route({route:'local',intelligence:'opus',complexity:'difficult',projectTitle:'Minecraft Explainer'});
   if(purpose==='answering')return text('Script: Steve opens a chest and finds Claude, who explains what it can do.');
   if(purpose==='execution'){if(failEdit){failEdit=false;throw new Error('Network unavailable');}const steps=(messages as any[]).filter(m=>m.role==='assistant').length;return steps===0?toolUse('pub','publish_project',{}):toolUse('done','finish',{status:'complete',summary:'Built the short from your script.'});}
   throw new Error('Unexpected '+purpose);
  };
  await director.message('Create a Minecraft animated short about Claude');expect(db.getMeta('ai_status')).toBe('interrupted');const first=pending(db);
  await director.message('wait can you make a script for it first');
  expect(calls.filter(c=>c.purpose==='routing').at(-1)!.messages).toContain('Create a Minecraft animated short about Claude');
  // The reply is offered the editing agent's tools so both read one cached prefix; the engine refuses its write calls.
  const answer=calls.at(-1)!,edit=calls.find(c=>c.purpose==='execution')!;expect(answer).toMatchObject({purpose:'answering',model:models.agent});expect(answer.tools).toEqual(edit.tools);
  expect(()=>parseCodeTool('write_file',{path:'a.txt',content:'x'},true,allowedTools('readonly'))).toThrow('unavailable');
  expect(db.getMeta('ai_status')).toBe('complete');expect(pending(db)).not.toBe(first);
  expect(db.state().messages.at(-1)).toMatchObject({role:'assistant',text:'Script: Steve opens a chest and finds Claude, who explains what it can do.'});
  expect(db.state().messages.filter(m=>m.turnId===first&&m.role==='user')).toHaveLength(1);

  failEdit=true;await director.message('Build it from that script');expect(db.getMeta('ai_status')).toBe('interrupted');const stopped=pending(db),before=calls.length;
  await director.message('continue');
  // The local heuristic recognizes continuing; no classification call and no new turn.
  expect(calls.slice(before).some(c=>c.purpose==='routing')).toBe(false);expect(pending(db)).toBe(stopped);expect(db.getMeta('ai_status')).toBe('complete');
  const resumed=calls.at(-1)!;expect(resumed.purpose).toBe('execution');expect(resumed.model).toBe(models.agent);expect(resumed.messages).toContain('Build it from that script');expect(resumed.messages).toContain('continue');
  expect(db.state().messages.at(-1)).toMatchObject({role:'assistant',text:'Built the short from your script.',report:{kind:'completion'}});
 }finally{db.close();}
});

it('lets the editing agent have helpers build separate pieces in parallel, which write only their own files and never publish; the agent integrates and publishes',async()=>{
 const db=fixture(),calls:Call[]=[];let agentCalls=0;try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspaceFor(db));
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   const head=(messages as any)[0].content,first=typeof head==='string'?head:head.filter((b:any)=>b.type==='text').at(-1).text;calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:first});
   if(purpose==='routing')return route({route:'local',intelligence:'sonnet'});
   if(purpose==='execution'){agentCalls++;
    if(agentCalls===1)return toolUse('assign','delegate',{tasks:[{id:'intro',title:'Build the intro',brief:'Write the intro scene.',writes:['src/intro']},{id:'outro',title:'Build the outro',brief:'Write the outro scene.',writes:['src/outro']}]});
    if(agentCalls===2){expect(JSON.stringify(messages)).toContain('Wrote src/intro/scene.tsx');return toolUse('pub','publish_project',{});}
    return toolUse('done','finish',{status:'complete',summary:'Built the intro and outro and placed them.'});}
   const done=JSON.stringify(messages).includes('tool_result'),piece=first.includes('Build the intro')?'intro':'outro';
   if(done)return toolUse('built-'+piece,'finish',{status:'complete',summary:`Wrote src/${piece}/scene.tsx; declare {"id":"${piece}","path":"src/${piece}/scene.tsx","kind":"scene","durationInFrames":90}.`});
   // A helper that tries to place its scene itself is told the editor does that.
   return{content:[{type:'tool_use',id:'tl-'+piece,name:'write_file',input:{path:'project.json',content:'{}'}},{type:'tool_use',id:'w-'+piece,name:'write_file',input:{path:`src/${piece}/scene.tsx`,content:'export default()=>null;'}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Make an intro and an outro for my video');expect(db.getMeta('ai_status')).toBe('complete');
  const agent=calls.find(c=>c.purpose==='execution')!,helpers=calls.filter(c=>c.purpose==='worker');
  expect(agent.model).toBe(models.agent);expect(agent.tools).toEqual(expect.arrayContaining(['delegate','write_file','publish_project']));
  expect(helpers.length).toBeGreaterThanOrEqual(4);expect(helpers.every(c=>c.model===models.agent)).toBe(true);
  for(const name of ['publish_project','delegate','propose_file_changes','import_media'])expect(helpers[0].tools).not.toContain(name);
  expect(helpers[0].messages).toContain('Do not edit project.json and do not publish');
  const refused=db.loadState<any>(`code-agent:${pending(db)}:main:worker:assign:intro`)?.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).find((b:any)=>b.type==='tool_result'&&b.tool_use_id==='tl-intro');
  expect(String(refused?.content)).toContain('Helpers do not edit project.json');
  const rows=(db.turnActivity(pending(db))?.events??[]).filter(e=>e.parent==='worker:assign:intro');expect(rows.length).toBeGreaterThan(0);
 }finally{db.close();}
});

it('tells a repeatedly failing edit to diagnose, then ends it as blocked on the third identical failure, on Sonnet alone',async()=>{
 const db=fixture(),calls:Call[]=[];try{
  const workspace={...workspaceFor(db),execute:async(name:string)=>{if(name==='write_file')throw new Error('The scene file could not be written: disk full');return{publication:{versionId:db.head(),assets:[],unchanged:true}};}};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:JSON.stringify(messages)});
   if(purpose==='routing')return route({route:'local',intelligence:'opus'});
   return toolUse('w'+calls.length,'write_file',{path:'src/title.tsx',content:'export default()=>null;'});
  };
  await director.message('Add a title card that says Hello');
  expect(db.getMeta('ai_status')).toBe('interrupted');expect(db.state().messages.at(-1)!.text).toContain('disk full');
  const runs=calls.filter(c=>c.purpose==='execution');expect(runs).toHaveLength(3);expect(new Set(calls.map(c=>c.model))).toEqual(new Set([models.agent]));
  // The second failure's result asks for a diagnosis; one conversation throughout.
  expect(runs[2].messages).toMatch(/diagnosisRequired\\*":true/);expect(runs.every(c=>c.phase==='main')).toBe(true);
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN ('ai.escalation','ai.mode_switch')").get()).toMatchObject({n:0});
 }finally{db.close();}
});

it('keeps the editing agent on the five-minute cache until a wait for its helpers outlasts it',async()=>{
 const {helperWaitCache,noteHelperWait}=await import('../../packages/orchestrator/src/code-director');const db=fixture();try{
  expect(helperWaitCache(db,'turn')).toEqual({});noteHelperWait(db,'turn',180_000);expect(helperWaitCache(db,'turn')).toEqual({});
  noteHelperWait(db,'turn',300_000);expect(helperWaitCache(db,'turn')).toEqual({cacheTtl:'1h'});expect(helperWaitCache(db,'other')).toEqual({});
 }finally{db.close();}
});
