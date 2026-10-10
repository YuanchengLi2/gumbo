import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {Director} from '../../packages/orchestrator/src/legacy-director';
import {models} from '@dream/config';
import {ProjectContext} from '../../packages/orchestrator/src/context';
import {classifyLocally} from '../../packages/orchestrator/src/routing';
import {operationSchemas} from '../../packages/orchestrator/src/tool-context';
import {OpSchema} from '@dream/timeline';
import {z} from 'zod';
import {intelligence} from '../../packages/orchestrator/src/intelligence';
const response=(...content:any[])=>({content,stop_reason:'tool_use',usage:{}});
const call=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
it('hands a misclassified mixed question and edit back to the executor in the same turn',async()=>{
 const {db}=fixture();try{
  const seen:string[]=[],director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});
  director.inference=async(model,_system,_messages,tools=[])=>{seen.push(model);
   if(tools.some((t:any)=>t.name==='select_route'))return response(call('route','select_route',{route:'question',intelligence:'opus'}));
   if(tools.some((t:any)=>t.name==='request_execution'))return response(call('handoff','request_execution',{instruction:'Apply the requested 24 fps format.'}));
   if(tools.some((t:any)=>t.name==='submit_guidance'))return response(call('advice','submit_guidance',{assessment:'Preserve source range.',instructions:['Change frame rate only.'],needsUser:false}));
   return response(call('change','apply_ops',{label:'Format',ops:[{type:'set_project_settings',settings:{fps:24},reason:'Requested'}],finish:{summary:'Saved.'}}));
  };
  await director.message('Ask Opus about timing, then set the frame rate to 24.');expect(db.timeline().settings.fps).toBe(24);expect(db.state().aiStatus).toBe('complete');expect(seen.at(-1)).toBe(models.editor);expect(seen.filter(m=>m===models.director)).toHaveLength(2);
 }finally{db.close();}
});
it('pauses for an essential Opus decision and feeds the answer back before any mutation',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-consult-pause-'));let db=new ProjectDB(folder,'Pause');
 try{
  let edits=0,consultations=0;
  const attach=(director:Director)=>{director.inference=async(_model,_system,messages,tools=[])=>{
   if(tools.some((t:any)=>t.name==='select_route'))return response(call('route','select_route',{route:'local',intelligence:'opus',complexity:'difficult'}));
   if(tools.some((t:any)=>t.name==='submit_guidance')){consultations++;const answered=JSON.stringify(messages).includes('Use a square format');return response(call('guidance','submit_guidance',{assessment:answered?'Format chosen':'Choose a format',instructions:[answered?'Set square dimensions.':'Which format should this use?'],question:'Which format should this use?',needsUser:!answered}));}
   edits++;return response(call('save','apply_ops',{label:'Format',ops:[{type:'set_project_settings',settings:{width:1080,height:1080},reason:'Chosen format'}],finish:{summary:'Saved square format.'}}));
  };};
  const first=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});attach(first);await first.message('Ask Opus to choose a complex format');expect(db.state().aiStatus).toBe('interrupted');expect(edits).toBe(0);
  db.close();db=new ProjectDB(folder);const next=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});attach(next);await next.resume('Use a square format');expect(edits).toBe(1);expect(consultations).toBe(2);expect(db.state().aiStatus).toBe('complete');
  expect(intelligence(models.editor,'routine',{complexity:'simple'}).effort).toBe('low');expect(intelligence(models.editor,'routine',{complexity:'normal'}).effort).toBe('medium');expect(intelligence(models.editor,'routine',{},2).effort).toBe('high');
 }finally{db.close();}
});
function fixture(count=1){const folder=mkdtempSync(join(tmpdir(),'dream-retrieval-')),db=new ProjectDB(folder,'Retrieval');db.saveAsset(AssetSchema.parse({id:'a',filename:'Product footage',kind:'video',durationSec:600,originalPath:'C:/private/source.mp4',fingerprint:'source',status:'ready'}));for(let offset=0;offset<count;offset+=50)db.apply(Array.from({length:Math.min(50,count-offset)},(_,n)=>({type:'insert_clip' as const,position:offset+n,clip:{id:`c${offset+n}`,assetId:'a',srcIn:offset+n,srcOut:offset+n+1,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:false},reason:offset+n===count-1?'Amethyst ending':'Opening product scene'},reason:'Fixture'})),'Fixture',`fixture-${offset}`,db.head());return{folder,db};}

it('retrieves late project records without sending a large timeline and invalidates changed chunks after reopening',()=>{
 const f=fixture(200);let db=f.db;try{
  const context=new ProjectContext(db),packet=JSON.stringify(context.initial('Refine the amethyst ending',['c199']));expect(packet.length).toBeLessThan(19000);expect(packet).toContain('c199');expect(packet).not.toContain('C:/private');expect(packet).not.toContain('"c100"');
  const matches=context.search('amethyst');expect(matches.some(m=>m.owner==='c199')).toBe(true);expect(context.read('clip:c199:0')).toMatchObject({owner:'c199'});
  const page=context.page({section:'timeline',offset:190,limit:6}) as any;expect(page.items).toHaveLength(6);expect(page.nextOffset).toBe(196);expect(page.total).toBe(200);
  const count=db.db.prepare('SELECT COUNT(*) AS n FROM context_chunks').get();context.initial('Again');expect(db.db.prepare('SELECT COUNT(*) AS n FROM context_chunks').get()).toEqual(count);
  db.apply([{type:'delete_clips',clipIds:['c199'],reason:'Remove ending'}],'Remove','delete',db.head());db.close();db=new ProjectDB(f.folder);expect(new ProjectContext(db).search('amethyst')).toEqual([]);expect(()=>new ProjectContext(db).read('clip:c199:0')).toThrow('not found');
 }finally{db.close();}
});

it('executes a clear edit in one Sonnet call with a small tool prefix and a verified inline completion',async()=>{
 const {db}=fixture();try{
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});let calls=0;
  director.inference=async(model,system,messages,tools=[])=>{calls++;expect(model).toBe(models.editor);expect(system).toContain('Dream craft standards');expect(JSON.stringify(messages)).not.toContain('originalPath');expect(tools.some((t:any)=>t.name==='consult_director')).toBe(true);expect(tools.some((t:any)=>t.name==='create_score')).toBe(false);expect(tools.some((t:any)=>t.name==='load_tools')).toBe(true);expect(JSON.stringify(tools).length).toBeLessThan(JSON.stringify(z.toJSONSchema(OpSchema)).length/2);
   return response(call('trim','apply_ops',{label:'Trim',ops:[{type:'trim_clip',clipId:'c0',srcOut:.5,reason:'Requested'}],finish:{summary:'Trimmed to half a second.'}}));};
  await director.message('Trim the first clip to half a second');expect(calls).toBe(1);expect(db.state().aiStatus).toBe('complete');expect(db.timeline().spine[0].srcOut).toBe(.5);expect(db.state().messages.at(-1)?.text).toBe('Trimmed to half a second.');db.undo();expect(db.timeline().spine[0].srcOut).toBe(1);
  expect(operationSchemas({types:['trim_clip']})).toHaveLength(1);expect(()=>operationSchemas({types:['invented']})).toThrow('Unknown');
 }finally{db.close();}
});

it('loads new creative capabilities on demand and preserves them across interruption',async()=>{
 const {db,folder}=fixture();let active=db;
 try{
  const engine={capabilities:['audio' as const],apply:db.apply.bind(db),generate:async()=>{throw new Error('Unused');},list:()=>[],get:()=>{throw new Error('Unused');}};
  const first=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{},undefined,engine);let requests=0;
  first.inference=async()=>{requests++;if(requests===1)return response(call('load','load_tools',{groups:['audio']}));throw new Error('Disconnected');};
  await expect(first.edit('Improve this','turn',[],false)).rejects.toThrow('Disconnected');db.close();active=new ProjectDB(folder);
  const next=new Director(active,async()=>({url:'unused',token:'unused'}),()=>{},undefined,{...engine,apply:active.apply.bind(active)});
  next.inference=async(_m,_s,_messages,tools)=>{expect(tools!.some((t:any)=>t.name==='create_score')).toBe(true);return response(call('change','apply_ops',{label:'Format',ops:[{type:'set_project_settings',settings:{fps:24},reason:'Requested'}],finish:{summary:'Format saved.'}}));};
  await next.edit('Improve this','turn',[],false);expect(active.timeline().settings.fps).toBe(24);expect(active.state().versions).toHaveLength(3);
 }finally{active.close();}
});

it('routes demanding guidance to Opus then Sonnet, while ordinary planning defaults to Sonnet',async()=>{
 const {db}=fixture();try{
  expect(classifyLocally('Plan a square 24 fps edit','plan',1)?.intelligence).toBe('sonnet');expect(classifyLocally('Ask Opus for an intricate cinematic concept','auto',1)).toBeUndefined();
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{}),seen:string[]=[];
  director.inference=async(model,system,messages,tools)=>{seen.push(model);
   if(tools!.some((t:any)=>t.name==='select_route')){expect(JSON.parse((messages[0] as any).content).project).not.toHaveProperty('relevant');return response(call('route','select_route',{route:'local',intelligence:'opus',reason:'Requested director direction'}));}
   if(tools!.some((t:any)=>t.name==='submit_guidance')){expect(system).toContain('concrete palette');return response(call('guide','submit_guidance',{assessment:'A restrained concept fits.',instructions:['Keep the original composition.'],checks:['Preserve the source.'],needsUser:false}));}
   expect(JSON.stringify(messages)).toContain('Keep the original composition');return response(call('save','apply_ops',{label:'Timing',ops:[{type:'set_project_settings',settings:{fps:24},reason:'Requested'}],finish:{summary:'Timing saved.'}}));
  };
  await director.message('Ask Opus for a cinematic concept and set 24 fps');expect(seen).toEqual([models.router,models.director,models.editor]);expect(db.state().aiStatus).toBe('complete');
 }finally{db.close();}
});

it('lets a Sonnet planner consult Opus without switching to a separate workflow',async()=>{
 const {db}=fixture();try{
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{}),seen:string[]=[];let planning=0;
  director.inference=async(model,_system,messages,tools)=>{seen.push(model);
   if(tools!.some((t:any)=>t.name==='submit_guidance'))return response(call('advice','submit_guidance',{assessment:'Keep it legible.',instructions:['Use a single restrained accent.'],checks:['Check contrast over the actual background.'],needsUser:false}));
   if(++planning===1){expect(tools!.some((t:any)=>t.name==='consult_director')).toBe(true);return response(call('help','consult_director',{question:'How should the accent preserve readability?'}));}
   expect(JSON.stringify(messages)).toContain('single restrained accent');return response(call('plan','submit_plan',{schemaVersion:1,title:'Readable accent',goal:'Refine the visual',steps:[{id:'accent',title:'Accent',instruction:'Use a restrained accent',acceptance:'Readable over the background',review:true}],assumptions:[]}));
  };
  await director.message('Plan a visual accent',[],'plan');expect(seen).toEqual([models.editor,models.director,models.editor]);expect(db.state().aiStatus).toBe('awaiting_approval');expect(db.state().versions).toHaveLength(2);
 }finally{db.close();}
});
