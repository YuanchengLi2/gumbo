import {EditingEngine} from '../../apps/project-service/src/editing-engine';
import {beforeAll,it,expect} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve as pathResolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';
import {AssetSchema} from '@dream/footage';
import {arrangeScore,SoundDesignSchema} from '@dream/procedural-media';
import {MediaLibrary} from '../../apps/project-service/src/library';
import {collectProject} from '../../apps/project-service/src/collect';
const root=mkdtempSync(join(tmpdir(),'dream-media-library-')),worker=join(root,'procedural.cjs');
beforeAll(async()=>{await build({entryPoints:[pathResolve('apps/project-service/src/procedural-worker.ts')],outfile:worker,bundle:true,platform:'node',format:'cjs'});});
function fixture(name:string){const db=new ProjectDB(join(root,name),name);db.saveAsset(AssetSchema.parse({id:'video',filename:'source.mp4',originalPath:worker,kind:'video',durationSec:10,hasAudio:false,fingerprint:'fixture'}));db.apply([{type:'insert_clip',position:0,clip:{id:'clip',assetId:'video',srcIn:0,srcOut:10,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:true},reason:'fixture'},reason:'fixture'}],'Import','import',db.head());return{db,library:new MediaLibrary(db,worker,()=>{})};}
const score=()=>arrangeScore({id:'custom-score',title:'Custom score',seed:17,tempo:120,key:0,durationSec:.5,mood:'bright',intensity:.6,instruments:['keys','bass']});

it('places generated media, preserves revisions across undo/reopen and collects all stems',async()=>{
 let {db,library}=fixture('revisions');const folder=db.folder;
 try{
  const before=db.head(),command={type:'create_score' as const,document:score(),requestId:'score',expectedVersionId:before};
  const first=await library.generate(command,'turn-score');expect(first.placed).toBe(true);expect(db.timeline().music[0].scoreRevisionId).toBe(first.revisionId);
  const revision=library.get(first.revisionId);expect(revision.stemAssetIds).toHaveLength(2);const source=db.footage().assets.find(a=>a.id===first.assetId)!;const original=readFileSync(source.originalPath);
  const versions=db.state().versions.length;expect(await library.generate(command,'turn-score')).toEqual(first);expect(db.state().versions).toHaveLength(versions);
  const document=structuredClone(revision.document!);document.tracks[0].notes[0].pitch+=7;
  const second=await library.generate({type:'edit_score',scoreId:revision.definitionId,revisionId:first.revisionId,document,requestId:'revise',expectedVersionId:db.head()},'turn-revise');
  expect(second.assetId).not.toBe(first.assetId);expect(readFileSync(source.originalPath)).toEqual(original);expect(db.timeline(first.versionId).music[0].assetId).toBe(first.assetId);
  db.undo();expect(db.timeline().music[0].assetId).toBe(first.assetId);db.undo(true);expect(db.timeline().music[0].assetId).toBe(second.assetId);
  const sfx=await library.generate({type:'generate_sfx',presetId:'sfx_01',start:{kind:'clip',clipId:'clip',at:2,offsetSec:0},requestId:'sound',expectedVersionId:db.head()},'turn-sound');expect(sfx.placed).toBe(true);expect(db.timeline().attached[0].source?.assetId).toBe(sfx.assetId);
  const portable=join(root,'collected');await collectProject(db,portable);await library.close();db.close();
  db=new ProjectDB(folder);library=new MediaLibrary(db,worker,()=>{});expect(library.list()).toHaveLength(3);db.undo();expect(db.timeline().attached).toHaveLength(0);
  const collected=new ProjectDB(portable);try{expect(collected.timeline().attached[0].source?.assetId).toBe(sfx.assetId);for(const a of collected.footage().assets)expect(existsSync(a.originalPath)).toBe(true);}finally{collected.close();}
 }finally{await library.close();db.close();}
});

it('keeps a completed asset without overwriting intervening edits and cancels without partial registration',async()=>{
 const {db,library}=fixture('concurrent');try{
  const task=library.generate({type:'create_score',document:score(),requestId:'stale',expectedVersionId:db.head()});
  db.apply([{type:'set_project_settings',settings:{fps:60},reason:'User edit'}],'User edit','intervene',db.head());
  const result=await task;expect(result.placed).toBe(false);expect(result.warning).toContain('timeline changed');expect(db.timeline().music).toHaveLength(0);expect(library.get(result.revisionId).assetId).toBe(result.assetId);
  const count=library.list().length,assets=db.footage().assets.length;
  const canceled=library.generate({type:'generate_music',presetId:'score_01',durationSec:600,requestId:'cancel',expectedVersionId:db.head()});const rejection=expect(canceled).rejects.toThrow();
  await new Promise(r=>setTimeout(r,25));expect(db.state().timeline.settings.fps).toBe(60);library.cancel('cancel');await rejection;
  expect(library.list()).toHaveLength(count);expect(db.footage().assets).toHaveLength(assets);expect(db.state().jobs.find(j=>j.assetId==='cancel')?.status).toBe('interrupted');expect(readdirSync(join(db.folder,'Media/Generated')).some(n=>n.startsWith('.staging-'))).toBe(false);
 }finally{await library.close();db.close();}
});

it('renders a custom layered sound and places it without a manual add step',async()=>{
 const {db,library}=fixture('custom-sound');try{
  const sound=SoundDesignSchema.parse({schemaVersion:1,id:'custom-sound',title:'Soft descending ping',seed:22,durationSec:.4,layers:[{id:'tone',wave:'sine',startSec:0,durationSec:.4,frequencyHz:800,endFrequencyHz:300,gainDb:-6,pan:-.3,attackSec:.01,releaseSec:.3,filterHz:4000}]});
  const result=await library.generate({type:'create_sfx',sound,requestId:'custom',expectedVersionId:db.head()});expect(result.placed).toBe(true);expect(library.get(result.revisionId).sound).toEqual(sound);expect(db.timeline().attached[0].source?.assetId).toBe(result.assetId);
 }finally{await library.close();db.close();}
});

it('resumes a canceled AI generation tool without skipping it or repeating earlier mutations',async()=>{
 const fixtureState=fixture('ai-resume'),db=fixtureState.db;await fixtureState.library.close();let director:Director|undefined,cancelOnce=true;
 const engine=new EditingEngine(db,{audioWorker:worker},(type)=>{if(type==='state'&&cancelOnce&&db.state().jobs.some(j=>j.step==='creation'&&j.status==='queued')){cancelOnce=false;director!.cancel();}});
 try{
  director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{},undefined,engine);let editorCalls=0;
  director.inference=async(_model,_system,_messages,tools)=>{
   if(tools?.some((t:any)=>t.name==='select_route'))return{content:[{type:'tool_use',id:'route',name:'select_route',input:{route:'local'}}],stop_reason:'tool_use',usage:{}};
   editorCalls++;return{content:editorCalls===1?[{type:'tool_use',id:'fps',name:'apply_ops',input:{label:'Set frame rate',ops:[{type:'set_project_settings',settings:{fps:60},reason:'User requested'}]}},{type:'tool_use',id:'score',name:'create_score',input:{document:score()}}]:[{type:'tool_use',id:'done',name:'report',input:{summary:'Created the score.',status:'complete',evidence:[{toolCallId:'score',finding:'Score rendered and placed.'}]}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Add a score and set 60 fps');expect(db.state().aiStatus).toBe('interrupted');expect(db.timeline().settings.fps).toBe(60);expect(db.timeline().music).toHaveLength(0);expect(JSON.parse(db.getMeta('editor_checkpoint')!).processed).toBe(1);
  await director.resume();expect(db.state().aiStatus).toBe('complete');expect(db.timeline().music).toHaveLength(1);expect(editorCalls).toBe(2);expect(engine.list('audio')).toHaveLength(1);db.undo();expect(db.timeline().settings.fps).toBe(30);expect(db.timeline().music).toHaveLength(0);
 }finally{await engine.close();db.close();}
});
