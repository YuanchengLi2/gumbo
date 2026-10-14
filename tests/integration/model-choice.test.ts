import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models,engineBudgets,agentModels} from '@dream/config';
import {Director} from '../../packages/orchestrator/src/code-director';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-models-')));
const text=(value:string)=>({content:[{type:'text',text:value}],stop_reason:'end_turn',usage:{}});
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const route=(value:Record<string,unknown>)=>text(JSON.stringify({complexity:'normal',reason:'Fixture route',approvalQuote:null,...value}));
const workspace=(db:ProjectDB)=>({initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}});
const withClip=(db:ProjectDB)=>{db.saveAsset({id:'v',filename:'Beach.mp4',kind:'video',originalPath:'v.mp4',durationSec:20,fps:30,width:1920,height:1080,hasAudio:true,fingerprint:'v',status:'ready'} as any);db.apply([{type:'insert_clip',position:0,clip:{id:'a',assetId:'v',srcIn:0,srcOut:4,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Fixture'},reason:'Fixture'}] as any,'Fixture','fixture-clip',db.head());db.setMeta('project_title_source','ai');};

it('uses one model for everything: Sonnet',()=>{
 expect(models).toEqual({agent:'claude-sonnet-5-5'});
});

it('runs the edit, a reply and a plan on Sonnet without a model call to route them',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const calls:{purpose:string;model:string;tools:number}[]=[];let next:Record<string,unknown>={route:'local',intelligence:'opus'};
  director.inference=async(model,_s,messages:any,tools:any=[],_turn,_f,purpose='execution')=>{calls.push({purpose,model,tools:tools.length});
   if(purpose==='routing')return route(next);
   if(purpose==='answering')return text('It is 4 seconds long.');
   if(purpose==='planning')return toolUse('plan','finish',{status:'complete',summary:'Plan ready.',plan:{schemaVersion:1,title:'Intro',goal:'Add an intro',steps:[{id:'intro',title:'Add the intro',instruction:'Build it',acceptance:'Intro plays',review:false}],assumptions:[]}});
   return JSON.stringify(messages).includes('"pub"')?toolUse('done','finish',{status:'complete',summary:'Done.'}):toolUse('pub','publish_project',{});};
  await director.message('Could you build an animated intro, a chart scene and new music for this?');
  next={route:'question',intelligence:'haiku'};await director.message('How long is the video?');
  next={route:'plan',intelligence:'opus',approvalQuote:'Plan'};await director.message('Plan an intro for this');
  const by=(purpose:string)=>new Set(calls.filter(c=>c.purpose===purpose).map(c=>c.model));
  expect(by('routing')).toEqual(new Set());expect(by('execution')).toEqual(new Set([agentModels.sonnet]));expect(by('answering')).toEqual(new Set([agentModels.sonnet]));expect(by('planning')).toEqual(new Set([agentModels.sonnet]));
  expect(new Set(calls.map(c=>c.purpose))).toEqual(new Set(['execution','answering','planning']));
  // A reply looks at what it needs with the read-only tools.
  expect(calls.find(c=>c.purpose==='answering')!.tools).toBeGreaterThan(0);
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN ('ai.escalation','ai.mode_switch')").get()).toMatchObject({n:0});
 }finally{db.close();}
});

it('stops a request that used all its steps as blocked, with its work saved and no other model',async()=>{
 const db=fixture();try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const used=new Set<string>();let steps=0;
  director.inference=async(model,_s,_m,_t,_turn,_f,purpose='execution')=>{
   if(purpose==='routing')return route({route:'local',intelligence:'sonnet'});
   used.add(model);steps++;return{content:[{type:'text',text:'Checking clip '+steps},{type:'tool_use',id:'r'+steps,name:'read_file',input:{path:`src/scene${steps}.tsx`}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Build a long animated sequence from scratch');
  expect(steps).toBe(engineBudgets.agentSteps);expect([...used]).toEqual([models.agent]);
  expect(db.getMeta('ai_status')).toBe('interrupted');expect(db.state().messages.at(-1)!.text).toContain('step limit');
 }finally{db.close();}
});

it('Auto runs each request on the model its triage score calls for, and keeps a stopped request\'s asks when the next message wants them',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const calls:{purpose:string;model:string;first:string}[]=[];let score:Record<string,unknown>={};
  director.inference=async(model,_s,messages:any,_tools:any=[],_turn,_f,purpose='execution')=>{calls.push({purpose,model,first:JSON.stringify(messages[0])});
   if(purpose==='triage')return text(JSON.stringify({kind:'edit',difficulty:3,vision:false,carriesStopped:false,parts:['x'],reason:'fixture',...score}));
   return JSON.stringify(messages).includes('"pub"')?toolUse('done','finish',{status:'complete',summary:'Done.'}):toolUse('pub','publish_project',{});};
  const ran=()=>calls.filter(c=>c.purpose==='execution').at(-1)!;
  score={difficulty:1};await director.message('make the caption white',[],'auto',[],undefined,undefined,'auto');expect(ran().model).toBe(agentModels.haiku);
  score={difficulty:4};await director.message('add b-roll and a motion graphic where I describe plans',[],'auto',[],undefined,undefined,'auto');expect(ran().model).toBe(agentModels.sonnet);
  score={difficulty:5};await director.message('condense the vlog to 10 minutes',[],'auto',[],undefined,undefined,'auto');expect(ran().model).toBe(agentModels.opus);
  // The triage's parts are what finishing reports on.
  score={difficulty:3,parts:['make the drawings black','add music that fits each section']};await director.message('make the drawings black and add music',[],'auto',[],undefined,undefined,'auto');
  expect(ran().first).toContain('p2: add music that fits each section');
  // A stopped request, then "aside from that…": its asks ride along with the new one.
  db.setMeta('ai_status','interrupted');db.setMeta('pending_request',JSON.stringify({text:'put the actual thing on screen with the definition',selection:[],intent:'auto',assetIds:[],turnId:'stopped-turn'}));
  score={difficulty:3,carriesStopped:true};await director.message('aside from that make the drawings black',[],'auto',[],undefined,undefined,'auto');
  expect(ran().first).toContain('Still wanted from the request that was stopped');expect(ran().first).toContain('with the definition');
  expect(db.state().messages.filter(m=>m.role==='user').at(-1)!.text).toBe('aside from that make the drawings black');
 }finally{db.close();}
});

it('runs an approved plan, and a continued request, on the model picked when approving, not the one that planned it',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const calls:{purpose:string;model:string}[]=[];
  director.inference=async(model,_s,messages:any,_tools:any=[],_turn,_f,purpose='execution')=>{calls.push({purpose,model});
   if(purpose==='planning')return toolUse('plan','finish',{status:'complete',summary:'Plan ready.',plan:{schemaVersion:1,title:'Intro',goal:'Add an intro',steps:[{id:'intro',title:'Add the intro',instruction:'Build it',acceptance:'Intro plays',review:false}],assumptions:[]}});
   return JSON.stringify(messages).includes('"pub"')?toolUse('done','finish',{status:'complete',summary:'Done.'}):toolUse('pub','publish_project',{});};
  // Requests from the composer are scored by Haiku first (triage); the picked model does all the work.
  const work=()=>calls.filter(c=>c.purpose!=='triage');
  await director.message('Plan an intro for this',[],'plan',[],undefined,undefined,'opus');
  expect(calls.filter(c=>c.purpose==='triage').map(c=>c.model)).toEqual([agentModels.haiku]);
  expect(new Set(work().map(c=>c.model))).toEqual(new Set([agentModels.opus]));calls.length=0;
  await director.message('Go ahead',[],'auto',[],undefined,undefined,'sonnet');
  expect(work().length).toBeGreaterThan(0);expect(new Set(work().map(c=>c.model))).toEqual(new Set([agentModels.sonnet]));
 }finally{db.close();}
});
