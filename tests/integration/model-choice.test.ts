import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models,engineBudgets} from '@dream/config';
import {Director,plainEdit} from '../../packages/orchestrator/src/code-director';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-models-')));
const text=(value:string)=>({content:[{type:'text',text:value}],stop_reason:'end_turn',usage:{}});
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const route=(value:Record<string,unknown>)=>text(JSON.stringify({complexity:'normal',reason:'Fixture route',approvalQuote:null,...value}));
const workspace=(db:ProjectDB)=>({initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}});
const withClip=(db:ProjectDB)=>{db.saveAsset({id:'v',filename:'Beach.mp4',kind:'video',originalPath:'v.mp4',durationSec:20,fps:30,width:1920,height:1080,hasAudio:true,fingerprint:'v',status:'ready'} as any);db.apply([{type:'insert_clip',position:0,clip:{id:'a',assetId:'v',srcIn:0,srcOut:4,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Fixture'},reason:'Fixture'}] as any,'Fixture','fixture-clip',db.head());db.setMeta('project_title_source','ai');};

it('uses one model for everything: Sonnet',()=>{
 expect(models).toEqual({agent:'claude-sonnet-5-5'});
});

it('recognizes plain follow-up edits, but not questions, scripts or plans',()=>{
 for(const edit of ['Extend the last clip by 30 seconds.','Make it feel more gloomy and cinematic.','Add short crossfades between the clips and speed up the middle clip a little.','Now cut anything shaky','Swap the last clip for a different video from my computer that fits the mood better.','Put quiet, moody instrumental music under the whole video.'])expect(plainEdit(edit),edit).toBe(true);
 for(const other of ['How long is the video now?','Make a script for it first','Could you make it warmer?','I think the opening is slow','Plan a three-part teaser'])expect(plainEdit(other),other).toBe(false);
});

it('sends a plain follow-up edit straight to the agent without a router call',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const purposes:string[]=[],used:string[]=[];
  director.inference=async(model,_s,messages:any,_t,_turn,_f,purpose='execution')=>{purposes.push(purpose);used.push(model);return messages.some((m:any)=>m.role==='assistant')?toolUse('done','finish',{status:'complete',summary:'Warmer now.'}):toolUse('pub','publish_project',{});};
  await director.message('Make it a little warmer');
  expect(purposes).not.toContain('routing');expect(new Set(used)).toEqual(new Set([models.agent]));expect(db.getMeta('ai_status')).toBe('complete');
 }finally{db.close();}
});

it('runs the router, the edit, a reply and a plan on Sonnet whatever tier the router names',async()=>{
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
  expect(new Set(calls.map(c=>c.model))).toEqual(new Set([models.agent]));
  expect(new Set(calls.map(c=>c.purpose))).toEqual(new Set(['routing','execution','answering','planning']));
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
