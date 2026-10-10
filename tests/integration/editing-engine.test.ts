import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {VisualDefinitionSchema,type VisualRenderer} from '@dream/contracts';
import {Director} from '../../packages/orchestrator/src/legacy-director';
import {EditingEngine} from '../../apps/project-service/src/editing-engine';

it('one director executes mixed edits, animation and sound through one engine with durable turn undo',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-engine-')),worker=join(root,'procedural.cjs'),cache=join(root,'frames');mkdirSync(cache);
 await build({entryPoints:[resolve('apps/project-service/src/procedural-worker.ts')],outfile:worker,bundle:true,platform:'node',format:'cjs'});
 const frames=[0,1,2].map(frame=>{const bytes=Buffer.from(`frame:${frame}`);writeFileSync(join(cache,String(frame).padStart(6,'0')+'.png'),bytes);return{frame,sha256:createHash('sha256').update(bytes).digest('hex')};});
 const definition=VisualDefinitionSchema.parse({schemaVersion:1,id:'scene',title:'Scene',code:'export default function Scene(){return null}',parameters:{},parameterSchema:{},width:64,height:64,fps:30,durationInFrames:3,seed:1});
 const renderer:VisualRenderer=async()=>({directory:cache,cacheHit:false,manifest:{revisionId:'1'.repeat(64),runtimeVersion:'fixture',width:64,height:64,fps:30,durationInFrames:3,frames,stills:[0,1,1,2].map(frame=>({frame,mimeType:'image/png',base64:Buffer.from(`frame:${frame}`).toString('base64')}))}});
 let db=new ProjectDB(join(root,'project'),'Engine');db.saveAsset(AssetSchema.parse({id:'source',filename:'Fixture',kind:'video',durationSec:2,originalPath:worker,fingerprint:'fixture'}));db.apply([{type:'insert_clip',position:0,clip:{id:'clip',assetId:'source',srcIn:0,srcOut:2,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:true},reason:'fixture'},reason:'fixture'}],'Fixture','fixture',db.head());
 let engine=new EditingEngine(db,{audioWorker:worker,renderVisual:renderer},()=>{});
 try{
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{},undefined,engine);let calls=0;
  director.inference=async(_model,_system,_messages,tools)=>{
   if(tools?.some((tool:any)=>tool.name==='select_route'))return{content:[{type:'tool_use',id:'route',name:'select_route',input:{route:'local'}}],usage:{},stop_reason:'tool_use'};
   calls++;return{content:calls===1?[
    {type:'tool_use',id:'edit',name:'apply_ops',input:{label:'Quiet source',ops:[{type:'set_clip_audio',clipId:'clip',audio:{gainDb:-6},reason:'Mix balance'}]}},
    {type:'tool_use',id:'animation',name:'create_visual',input:{definition:JSON.stringify(definition),placement:'overlay',start:{kind:'project',at:'start',offsetSec:0}}},
    {type:'tool_use',id:'sound',name:'generate_sfx',input:{presetId:'sfx_01',start:{kind:'project',at:'start',offsetSec:0}}}
   ]:[{type:'tool_use',id:'done',name:'report',input:{summary:'Created an animation and matching accent.',status:'complete',evidence:['edit','animation','sound'].map(toolCallId=>({toolCallId,finding:'Committed successfully'}))}}],usage:{},stop_reason:'tool_use'};
  };
  await director.message('Create a short motion accent and a matching sound, with quieter source audio.');expect(db.state().aiStatus).toBe('complete');expect(db.timeline().attached.map(item=>item.type)).toEqual(['overlay','sfx']);expect(engine.list('visual')).toHaveLength(1);expect(engine.list('audio')).toHaveLength(1);
  const requests=(db.db.prepare("SELECT key FROM meta WHERE key LIKE 'creation:%'").all() as {key:string}[]).map(row=>row.key.slice(9)),versions=db.state().versions.length;expect(requests).toHaveLength(2);
  await engine.close();db.close();db=new ProjectDB(join(root,'project'));engine=new EditingEngine(db,{audioWorker:worker,renderVisual:renderer},()=>{});engine.recover();for(const id of requests)await engine.resume(id);expect(db.state().versions).toHaveLength(versions);
  engine.undo();expect(db.timeline().attached).toHaveLength(0);expect(db.timeline().spine[0].audio.gainDb).toBe(0);engine.undo(true);expect(db.timeline().attached).toHaveLength(2);expect(db.timeline().spine[0].audio.gainDb).toBe(-6);
 }finally{await engine.close();db.close();}
});
