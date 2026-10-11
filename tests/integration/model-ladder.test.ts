import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models,engineBudgets} from '@dream/config';
import {Director,nextMode,plainEdit} from '../../packages/orchestrator/src/code-director';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-ladder-')));
const text=(value:string)=>({content:[{type:'text',text:value}],stop_reason:'end_turn',usage:{}});
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const route=(value:Record<string,unknown>)=>text(JSON.stringify({complexity:'normal',reason:'Fixture route',approvalQuote:null,...value}));
const workspace=(db:ProjectDB)=>({initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}});
const pending=(db:ProjectDB)=>JSON.parse(db.getMeta('pending_request')!).turnId as string;
const withClip=(db:ProjectDB)=>{db.saveAsset({id:'v',filename:'Beach.mp4',kind:'video',originalPath:'v.mp4',durationSec:20,fps:30,width:1920,height:1080,hasAudio:true,fingerprint:'v',status:'ready'} as any);db.apply([{type:'insert_clip',position:0,clip:{id:'a',assetId:'v',srcIn:0,srcOut:4,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Fixture'},reason:'Fixture'}] as any,'Fixture','fixture-clip',db.head());db.setMeta('project_title_source','ai');};

it('moves a failing request one step up: Haiku to Sonnet alone, Sonnet to the Opus director',()=>{
 expect(nextMode({role:'solo',model:models.editor},{to:'lead',kind:'escalate'})).toEqual({role:'solo',model:models.sonnet});
 expect(nextMode({role:'solo',model:models.sonnet},{to:'lead',kind:'escalate'})).toEqual({role:'lead',model:models.director});
 expect(nextMode({role:'lead',model:models.sonnet},{to:'lead',kind:'escalate'})).toEqual({role:'lead',model:models.director});
 // Asking for direction gets a Sonnet director; a director's handoff goes back to Haiku.
 expect(nextMode({role:'solo',model:models.editor},{to:'lead',kind:'orchestrate'})).toEqual({role:'lead',model:models.sonnet});
 expect(nextMode({role:'lead',model:models.director},{to:'solo',kind:'handoff'})).toEqual({role:'solo',model:models.editor});
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

it('gives a multi-part build on an existing video a Sonnet director even when the router says Opus',async()=>{
 const db=fixture();try{withClip(db);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const leads:string[]=[];
  director.inference=async(model,_s,_m,_t,_turn,_f,purpose='execution')=>{if(purpose==='routing')return route({route:'local',intelligence:'opus'});if(purpose==='lead')leads.push(model);return toolUse('done','finish',{status:'blocked',summary:'Stopped for the test.',nextAction:'None.'});};
  await director.message('Could you build an animated intro, a chart scene and new music for this?');
  expect(leads[0]).toBe(models.sonnet);
  await director.message('Ask Opus to direct a new animated intro and outro for this');
  expect(leads.at(-1)).toBe(models.director);
 }finally{db.close();}
});

it('hands a Haiku editor that used all its steps to Sonnet with what it had done',async()=>{
 const db=fixture();try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace(db));const byModel:Record<string,number>={};let sonnetBrief='';
  director.inference=async(model,_s,messages:any,_t,_turn,_f,purpose='execution')=>{
   if(purpose==='routing')return route({route:'local',intelligence:'haiku'});
   byModel[model]=(byModel[model]??0)+1;
   if(model===models.sonnet){sonnetBrief||=JSON.stringify(messages[0]);return messages.some((m:any)=>m.role==='assistant')?toolUse('done','finish',{status:'complete',summary:'Finished it.'}):toolUse('pub','publish_project',{});}
   return{content:[{type:'text',text:'Checking clip '+byModel[model]},{type:'tool_use',id:'r'+byModel[model],name:'read_file',input:{path:`src/scene${byModel[model]}.tsx`}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Build a long animated sequence from scratch');
  expect(byModel[models.editor]).toBe(engineBudgets.agentSteps);expect(db.getMeta('ai_status')).toBe('complete');
  expect(sonnetBrief).toContain('used all its steps');expect(sonnetBrief).toContain('Checking clip '+engineBudgets.agentSteps);
  expect(db.loadState<any>('modes:'+pending(db)+':main').phases.map((p:any)=>p.model)).toEqual([models.editor,models.sonnet]);
 }finally{db.close();}
});
