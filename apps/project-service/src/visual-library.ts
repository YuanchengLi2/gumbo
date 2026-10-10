import {VisualSourceStore} from '../../../packages/project-db/src/visual-source-store';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,copyFile,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {resolve,type Op} from '@dream/timeline';
import {VisualCommandSchema,VisualRenderResultSchema,VisualRevisionSchema,type VisualCommand,type VisualRenderer,type VisualResult} from '@dream/contracts';
import {CreationJobs} from './creation-jobs';

export class VisualLibrary{
 private jobs:CreationJobs;readonly sources:VisualSourceStore;
 constructor(private db:ProjectDB,private render:VisualRenderer,publish:(type:string,payload:unknown)=>void,jobs?:CreationJobs){this.sources=new VisualSourceStore(db);this.jobs=jobs??new CreationJobs(db,publish);this.jobs.register('visual',(command,turnId,signal)=>this.execute(VisualCommandSchema.parse(command),turnId,signal));}
 list(){return(this.db.db.prepare("SELECT json FROM library WHERE kind='visual_revision' ORDER BY rowid DESC").all() as {json:string}[]).map(row=>VisualRevisionSchema.parse(JSON.parse(row.json)));}
 get(id:string){const row=this.db.db.prepare("SELECT json FROM library WHERE id=? AND kind='visual_revision'").get(id) as {json:string}|undefined;const revision=row?VisualRevisionSchema.parse(JSON.parse(row.json)):undefined;if(!revision)throw new Error('Visual revision not found.');return revision;}
 recover(){this.jobs.recover();}
 resume(requestId:string){return this.jobs.resume(requestId);}
 cancel(requestId:string){this.jobs.cancel(requestId);}
 async close(){await this.jobs.close();}
 generate(raw:VisualCommand,turnId?:string,signal?:AbortSignal):Promise<VisualResult>{
  return this.jobs.run(VisualCommandSchema.parse(raw),turnId,signal) as Promise<VisualResult>;
 }
 private async execute(command:VisualCommand,turnId:string|undefined,signal:AbortSignal):Promise<VisualResult>{
  const assets=this.db.footage().assets.filter(a=>command.definition.assetIds.includes(a.id));
  const rendered=VisualRenderResultSchema.parse(await this.render({definition:this.sources.hydrate(command.definition),assets},signal,progress=>this.jobs.progress(command,progress.phase==='validating'?.1*progress.done/progress.total:.1+.9*progress.done/progress.total,progress.phase==='validating'?'Checking animation':'Rendering animation')));signal.throwIfAborted();const {manifest}=rendered;if(manifest.cacheKey&&createHash('sha256').update(JSON.stringify({cacheKey:manifest.cacheKey,frames:manifest.frames})).digest('hex')!==manifest.revisionId)throw new Error('Visual revision identity does not match the captured pixels.');
  if(manifest.frames.length!==command.definition.durationInFrames||manifest.width!==command.definition.width||manifest.height!==command.definition.height||manifest.fps!==command.definition.fps)throw new Error('Visual capture does not match its definition.');
  const root=join(this.db.folder,'Media/Generated'),destination=join(root,manifest.revisionId),staging=join(root,`.visual-${randomUUID()}`);await mkdir(staging,{recursive:true});
  try{
   for(let frame=0;frame<manifest.frames.length;frame++){signal.throwIfAborted();const entry=manifest.frames[frame],name=`${String(frame).padStart(6,'0')}.png`,bytes=await readFile(join(rendered.directory,name));if(entry.frame!==frame||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Generated frame verification failed.');await writeFile(join(staging,name),bytes);}
   await writeFile(join(staging,'manifest.json'),JSON.stringify(manifest));signal.throwIfAborted();await mkdir(destination,{recursive:true});for(const entry of manifest.frames){const name=`${String(entry.frame).padStart(6,'0')}.png`,target=join(destination,name);let valid=false;try{valid=createHash('sha256').update(await readFile(target)).digest('hex')===entry.sha256;}catch{}if(!valid)await copyFile(join(staging,name),target);}await copyFile(join(staging,'manifest.json'),join(destination,'manifest.json'));
  }finally{const rel=relative(root,staging);if(rel&&!isAbsolute(rel)&&!rel.startsWith('..'))await rm(staging,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  signal.throwIfAborted();const assetId=`a_visual_${manifest.revisionId.slice(0,24)}`,itemId=`visual-${createHash('sha256').update(command.requestId).digest('hex').slice(0,24)}`,duration=manifest.durationInFrames/manifest.fps;
  return this.db.db.transaction(()=>{
   this.db.saveAsset(AssetSchema.parse({id:assetId,filename:command.definition.title,kind:'video',durationSec:duration,fps:manifest.fps,width:manifest.width,height:manifest.height,hasAudio:false,originalPath:join(destination,'000000.png'),thumbnailPath:join(destination,'000000.png'),fingerprint:manifest.revisionId,status:'ready',sequence:{directory:destination,frameCount:manifest.durationInFrames,fps:manifest.fps,revisionId:manifest.revisionId}}));
   const revision=VisualRevisionSchema.parse({revisionId:manifest.revisionId,definition:this.sources.normalize(command.definition),assetId,createdAt:new Date().toISOString()});this.db.db.prepare('INSERT INTO library VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(manifest.revisionId,'visual_revision',JSON.stringify(revision));
   const t=this.db.timeline(),ops:Op[]=[],current=this.db.head()===command.expectedVersionId;
   if(current){
    if(command.replaceItemId){const clip=t.spine.find(c=>c.id===command.replaceItemId),item=t.attached.find(i=>i.id===command.replaceItemId);if(clip)ops.push({type:'replace_clip_source',clipId:clip.id,assetId,srcIn:0,srcOut:duration,reason:'Revise generated scene'});else if(item)ops.push({type:'update_item',itemId:item.id,changes:{source:{assetId,srcIn:0,srcOut:duration},durationSec:duration},reason:'Revise generated animation'});else throw new Error('The visual selected for replacement no longer exists.');}
    else if(command.placement==='overlay'&&resolve(t,this.db.footage()).durationInFrames>0)ops.push({type:'add_item',item:{id:itemId,type:'overlay',component:'generated_visual',start:command.start,durationSec:duration,source:{assetId,srcIn:0,srcOut:duration},params:{},layer:Math.max(-1,...t.attached.map(i=>i.layer))+1,reason:'Original coded animation'},reason:'Place original animation'});
    else if(command.placement==='spine'){
     const r=resolve(t,this.db.footage());let at=0;if(t.spine.length){const probe=resolve({...t,attached:[{id:'placement',type:'overlay',component:'generated_visual',start:command.start,durationSec:duration,params:{},layer:0,reason:'Resolve placement'}]},this.db.footage()).items[0];if(!probe)throw new Error('The visual placement anchor is unavailable.');at=probe.timelineStart;}
     let position=r.clips.findIndex(c=>c.start>=at-1/(t.settings.fps*2));if(position<0)position=t.spine.length;const crossing=r.clips.find(c=>at>c.start+1/(t.settings.fps*2)&&at<c.end-1/(t.settings.fps*2));if(crossing){ops.push({type:'split_clip',clipId:crossing.id,atSec:at-crossing.start,newClipId:`${itemId}-right`,reason:'Make room for generated scene'});position=r.clips.indexOf(crossing)+1;}
     ops.push({type:'insert_clip',position,clip:{id:itemId,assetId,srcIn:0,srcOut:duration,speed:1,audio:{gainDb:0,mute:true,fadeInSec:0,fadeOutSec:0},reason:'Original coded scene'},reason:'Place original scene'});
    }
   }
   const applied=ops.length?this.db.apply(ops,'Create animation',`visual:${command.requestId}`,command.expectedVersionId,turnId):undefined;
   const result:VisualResult={assetId,revisionId:manifest.revisionId,placed:!!applied,versionId:applied?.versionId,itemId:applied?command.replaceItemId??itemId:undefined,stills:manifest.stills,...(!current?{warning:'The timeline changed during rendering. The visual is saved; inspect the current edit and place its asset.'}:!applied?{warning:'Add a scene to the empty timeline or place this visual on the spine.'}:{})};this.jobs.commit(command,turnId,result);return result;
  })();
 }
}
