import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models} from '@dream/config';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {Director,parseCodeRoute} from '../../packages/orchestrator/src/code-director';
import {allowedTools} from '../../packages/orchestrator/src/code-tools';
import {routeCodeRequest} from '../../packages/orchestrator/src/routing';
import {inferencePolicy} from '../../supabase/functions/dream-gateway/inference-policy';

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
 expect((inferencePolicy(models.router,'routing').output_config as any).format.schema.properties.route.enum).toContain('continue');
});

it('answers a request for a script after a stop as a new turn, and continues the stopped request only when asked',async()=>{
 const db=fixture(),calls:Call[]=[];let failLead=true;try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspaceFor(db));
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:JSON.stringify(messages)});
   if(purpose==='routing')return JSON.parse((messages as any)[0].content).request.startsWith('wait')?route({route:'question',intelligence:'opus',reason:'Wants the script first'}):route({route:'local',intelligence:'opus',complexity:'difficult',projectTitle:'Minecraft Explainer'});
   if(purpose==='answering')return text('Script: Steve opens a chest and finds Claude, who explains what it can do.');
   if(purpose==='lead'){if(failLead){failLead=false;throw new Error('Network unavailable');}return toolUse('done','finish',{status:'complete',summary:'Built the short from your script.'});}
   throw new Error('Unexpected '+purpose);
  };
  await director.message('Create a Minecraft animated short about Claude');expect(db.getMeta('ai_status')).toBe('interrupted');const first=pending(db);
  await director.message('wait can you make a script for it first');
  expect(calls.filter(c=>c.purpose==='routing').at(-1)!.messages).toContain('Create a Minecraft animated short about Claude');
  const answer=calls.at(-1)!;expect(answer).toMatchObject({purpose:'answering',model:models.director,tools:[]});
  expect(db.getMeta('ai_status')).toBe('complete');expect(pending(db)).not.toBe(first);
  expect(db.state().messages.at(-1)).toMatchObject({role:'assistant',text:'Script: Steve opens a chest and finds Claude, who explains what it can do.'});
  expect(db.state().messages.filter(m=>m.turnId===first&&m.role==='user')).toHaveLength(1);

  failLead=true;await director.message('Build it from that script');expect(db.getMeta('ai_status')).toBe('interrupted');const stopped=pending(db),before=calls.length;
  await director.message('continue');
  // The local heuristic recognizes continuing; no classification call and no new turn.
  expect(calls.slice(before).some(c=>c.purpose==='routing')).toBe(false);expect(pending(db)).toBe(stopped);expect(db.getMeta('ai_status')).toBe('complete');
  const resumed=calls.at(-1)!;expect(resumed.purpose).toBe('lead');expect(resumed.messages).toContain('Build it from that script');expect(resumed.messages).toContain('continue');
  expect(db.state().messages.at(-1)).toMatchObject({role:'assistant',text:'Built the short from your script.',report:{kind:'completion'}});
 }finally{db.close();}
});

it('lets the director dispatch read-only research beside a build worker, which alone may publish and propose computer changes',async()=>{
 const db=fixture(),calls:Call[]=[];let leadCalls=0;try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspaceFor(db));
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   const head=(messages as any)[0].content,first=typeof head==='string'?head:head.filter((b:any)=>b.type==='text').at(-1).text;calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:first});
   if(purpose==='routing')return route({route:'local',intelligence:'opus'});
   if(purpose==='lead'){leadCalls++;
    if(leadCalls===1)return toolUse('assign','delegate',{tasks:[{id:'look',title:'Find the block textures',brief:'Which texture folders exist?',mode:'research'},{id:'scene',title:'Build the scene',brief:'Write src/scene.html and publish.',publish:true}]});
    expect(JSON.stringify(messages)).toContain('Textures are in the block folder.');return toolUse('done','finish',{status:'complete',summary:'Built the scene with your textures.'});}
   const done=JSON.stringify(messages).includes('tool_result');
   if(first.startsWith('Task (research)'))return toolUse('found','finish',{status:'complete',summary:'Textures are in the block folder.'});
   return done?toolUse('built','finish',{status:'complete',summary:'Wrote and published the scene.'}):{content:[{type:'tool_use',id:'write',name:'write_file',input:{path:'src/scene.html',content:'<script>window.renderFrame=()=>{}</script>'}},{type:'tool_use',id:'pub',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Create a scene with my Minecraft textures');expect(db.getMeta('ai_status')).toBe('complete');
  const research=calls.find(c=>c.messages.startsWith('Task (research)'))!,build=calls.find(c=>c.messages.startsWith('Task (build)'))!;
  expect(research.tools.sort()).toEqual(['find_media','finish','list_files','read_file','read_transcript','search','view_media']);expect(research.messages).toContain('research only');
  expect(build.tools).toEqual(expect.arrayContaining(['write_file','publish_project','propose_file_changes']));expect(build.tools).not.toContain('delegate');
  expect(calls.every(c=>c.purpose!=='lead'||c.model===models.lead)).toBe(true);expect(calls.filter(c=>c.purpose==='worker').every(c=>c.model===models.worker)).toBe(true);
  // Parallel builders can neither publish nor pause the request for computer changes.
  expect(allowedTools('worker',{canPublish:false,canPropose:false}).has('propose_file_changes')).toBe(false);
  const rows=(db.turnActivity(pending(db))?.events??[]).filter(e=>e.parent==='worker:assign:look');expect(rows.length).toBeGreaterThan(0);
 }finally{db.close();}
});

it('switches between Haiku alone and the director with a handoff each way, at most twice per request',async()=>{
 const db=fixture(),calls:Call[]=[];try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspaceFor(db));
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:JSON.stringify(messages)});const steps=(messages as any[]).filter(m=>m.role==='assistant').length;
   if(purpose==='routing')return route({route:'local',intelligence:'haiku'});
   if(purpose==='lead')return toolUse('back','hand_off',{brief:'The intro scene is written. Publish it and set it to 3 seconds.'});
   if(phase==='main')return toolUse('up','switch_to_orchestrated',{reason:'This needs several coordinated scenes.',handoff:'Wrote the intro scene; nothing is published yet.'});
   return steps===0?toolUse('pub','publish_project',{}):toolUse('done','finish',{status:'complete',summary:'Published the intro at 3 seconds.'});
  };
  await director.message('Make an intro, a demo and an outro that flow together');expect(db.getMeta('ai_status')).toBe('complete');
  const lead=calls.find(c=>c.purpose==='lead')!,last=calls.filter(c=>c.purpose==='execution').at(-1)!;
  expect(lead.model).toBe(models.lead);expect(lead.messages).toContain('Wrote the intro scene; nothing is published yet.');expect(lead.tools).toContain('hand_off');
  expect(last.phase).toBe('main:mode-2');expect(last.messages).toContain('Publish it and set it to 3 seconds.');expect(last.tools).not.toContain('switch_to_orchestrated');
  expect(calls.find(c=>c.phase==='main'&&c.purpose==='execution')!.tools).toContain('switch_to_orchestrated');
  expect(db.loadState<any>('modes:'+pending(db)+':main').phases.map((p:any)=>p.role)).toEqual(['solo','lead','solo']);
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.mode_switch'").get()).toMatchObject({n:2});
  expect(db.state().messages.at(-1)?.text).toBe('Published the intro at 3 seconds.');
 }finally{db.close();}
});

it('hands a repeatedly failing Haiku edit to the director, who finishes an unchanged project without publishing itself',async()=>{
 const db=fixture(),calls:Call[]=[],executed:string[]=[];try{
  const workspace={...workspaceFor(db,executed),execute:async(name:string)=>{executed.push(name);if(name==='write_file')throw new Error('The scene file could not be written: disk full');return{publication:{versionId:db.head(),assets:[],unchanged:true}};}};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);
  director.inference=async(model,_system,messages,tools=[],_turn,_force,purpose='execution',phase='main')=>{
   calls.push({purpose,model,phase,tools:(tools as any[]).map(t=>t.name),messages:JSON.stringify(messages)});
   if(purpose==='routing')return route({route:'local',intelligence:'haiku'});
   if(purpose==='lead')return toolUse('done','finish',{status:'complete',summary:'Nothing needed to change after all.'});
   return toolUse('w'+calls.length,'write_file',{path:'src/title.html',content:'<p>Title</p>'});
  };
  await director.message('Add a title card that says Hello');
  expect(db.getMeta('ai_status')).toBe('complete');expect(calls.filter(c=>c.purpose==='execution')).toHaveLength(2);
  expect(calls.find(c=>c.purpose==='lead')!.messages).toContain('kept failing');
  // The director never received a publishing tool; the engine confirmed the unchanged project.
  expect(calls.find(c=>c.purpose==='lead')!.tools).not.toContain('publish_project');expect(executed.filter(n=>n==='publish_project')).toHaveLength(1);
 }finally{db.close();}
});

it('refuses a director finish while worker changes are unpublished',async()=>{
 const db=fixture();try{let changes=['src/intro/scene.html'],n=0;const seen:string[]=[];
  const result=await codeAgent({db,turnId:'turn',model:models.lead,role:'lead',text:'Direct the edit',signal:new AbortController().signal,publish:()=>{},workspace:{...workspaceFor(db),unpublishedChanges:()=>changes} as any,
   infer:async(_m,_s,messages)=>{seen.push(JSON.stringify(messages.at(-1)));if(n++===1)changes=[];return toolUse('f'+n,'finish',{status:'complete',summary:'Done.'});}});
  expect(seen[1]).toContain('Delegate an integration task with publish:true');expect(seen[1]).toContain('src/intro/scene.html');expect(result.outcome.status).toBe('complete');
 }finally{db.close();}
});

it('keeps the lead on the five-minute cache until a wait for workers outlasts it',async()=>{
 const {leadCache,noteWorkerWait}=await import('../../packages/orchestrator/src/code-director');const db=fixture();try{
  expect(leadCache(db,'turn')).toEqual({});noteWorkerWait(db,'turn',180_000);expect(leadCache(db,'turn')).toEqual({});
  noteWorkerWait(db,'turn',300_000);expect(leadCache(db,'turn')).toEqual({cacheTtl:'1h'});expect(leadCache(db,'other')).toEqual({});
 }finally{db.close();}
});

it('gives the lead the text catalog of the footage without images',async()=>{
 const {leadMediaBlocks}=await import('../../packages/orchestrator/src/code-director');
 const blocks=[{type:'text',text:'catalog'},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'x'}},{type:'text',text:'transcript'}];
 const lead=leadMediaBlocks(blocks);expect(lead.some(b=>b.type==='image')).toBe(false);expect(lead.map(b=>b.text)).toEqual(['catalog','transcript',expect.stringContaining('go to the workers')]);
 expect(leadMediaBlocks([{type:'text',text:'catalog'}])).toEqual([{type:'text',text:'catalog'}]);
});
