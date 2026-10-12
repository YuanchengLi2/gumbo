import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models,engineBudgets} from '@dream/config';
import {Director,ladder,plainEdit} from '../../packages/orchestrator/src/code-director';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-ladder-')));
const text=(value:string)=>({content:[{type:'text',text:value}],stop_reason:'end_turn',usage:{}});
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const route=(value:Record<string,unknown>)=>text(JSON.stringify({complexity:'normal',reason:'Fixture route',approvalQuote:null,...value}));
const workspace=(db:ProjectDB)=>({initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}});
const pending=(db:ProjectDB)=>JSON.parse(db.getMeta('pending_request')!).turnId as string;
const withClip=(db:ProjectDB)=>{db.saveAsset({id:'v',filename:'Beach.mp4',kind:'video',originalPath:'v.mp4',durationSec:20,fps:30,width:1920,height:1080,hasAudio:true,fingerprint:'v',status:'ready'} as any);db.apply([{type:'insert_clip',position:0,clip:{id:'a',assetId:'v',srcIn:0,srcOut:4,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Fixture'},reason:'Fixture'}] as any,'Fixture','fixture-clip',db.head());db.setMeta('project_title_source','ai');};

it('climbs one ladder when a request keeps failing: Haiku, then Sonnet, then Opus',()=>{
 expect(ladder).toEqual([models.editor,models.sonnet,models.director]);
});

it('recognizes plain follow-up edits, but not questions, scripts or calls for a stronger model',()=>{
 for(const edit of ['Extend the last clip by 30 seconds.','Make it feel more gloomy and cinematic.','Add short crossfades between the clips and speed up the middle clip a little.','Now cut anything shaky','Swap the last clip for a different video from my computer that fits the mood better.','Put quiet, moody instrumental music under the whole video.'])expect(plainEdit(edit),edit).toBe(true);
 for(const other of ['How long is the video now?','Make a script for it first','Make it better, ask the director','Could you make it warmer?','I think the opening is slow','Plan a three-part teaser'])expect(plainEdit(other),other).toBe(false);
});

it('sends a plain follow-up edit straight to Haiku without a router call',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const purposes:string[]=[],used:string[]=[];
  director.inference=async(model,_s,messages:any,_t,_turn,_f,purpose='execution')=>{purposes.push(purpose);used.push(model);return messages.some((m:any)=>m.role==='assistant')?toolUse('done','finish',{status:'complete',summary:'Warmer now.'}):toolUse('pub','publish_project',{});};
  await director.message('Make it a little warmer');
  expect(purposes).not.toContain('routing');expect(new Set(used)).toEqual(new Set([models.editor]));expect(db.getMeta('ai_status')).toBe('complete');
 }finally{db.close();}
});

it('gives big work on an existing video Sonnet even when the router says Opus, and Opus only when asked by name',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const agents:string[]=[];
  director.inference=async(model,_s,_m,_t,_turn,_f,purpose='execution')=>{if(purpose==='routing')return route({route:'local',intelligence:'opus'});if(purpose==='execution')agents.push(model);return toolUse('done','finish',{status:'blocked',summary:'Stopped for the test.',nextAction:'None.'});};
  await director.message('Could you build an animated intro, a chart scene and new music for this?');
  expect(agents[0]).toBe(models.sonnet);
  await director.message('Ask Opus to make a new animated intro and outro for this');
  expect(agents.at(-1)).toBe(models.director);
 }finally{db.close();}
});

it('continues a Haiku editor that used all its steps on Sonnet, in the same conversation',async()=>{
 const db=fixture();try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const byModel:Record<string,number>={};let sonnetSees='';const phases=new Set<string>();
  director.inference=async(model,_s,messages:any,_t,_turn,_f,purpose='execution',phase='main')=>{
   if(purpose==='routing')return route({route:'local',intelligence:'haiku'});
   byModel[model]=(byModel[model]??0)+1;phases.add(phase);
   if(model===models.sonnet){sonnetSees||=JSON.stringify(messages);return JSON.stringify(messages).includes('"pub"')?toolUse('done','finish',{status:'complete',summary:'Finished it.'}):toolUse('pub','publish_project',{});}
   return{content:[{type:'text',text:'Checking clip '+byModel[model]},{type:'tool_use',id:'r'+byModel[model],name:'read_file',input:{path:`src/scene${byModel[model]}.tsx`}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Build a long animated sequence from scratch');
  expect(byModel[models.editor]).toBe(engineBudgets.agentSteps);expect(db.getMeta('ai_status')).toBe('complete');
  expect(sonnetSees).toContain('used all its steps');expect(sonnetSees).toContain('Checking clip '+engineBudgets.agentSteps);
  expect([...phases]).toEqual(['main']);
 }finally{db.close();}
});
