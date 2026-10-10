import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rmdir,rm} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {GenerationSchema,LibraryRevisionSchema,type GenerationCommand,type LibraryRevision,type GenerationResult} from '@dream/contracts';
import {arrangeScore,bindScore,scoreCatalog,sfxCatalog,ScoreSchema,SCORE_RENDERER_VERSION,type ScoreDocument,type SoundDesign} from '@dream/procedural-media';
import {AssetSchema} from '@dream/footage';
import {resolve,type Op} from '@dream/timeline';
import {renderProcedural,RenderedScoreSchema,type RenderedScore} from './procedural-client';
import {fingerprint} from './media';
import {CreationJobs} from './creation-jobs';

export class MediaLibrary {
 private stopped=false;private jobs:CreationJobs;
 private bindingTimer:ReturnType<typeof setTimeout>|undefined;private bindingAttempts=new Set<string>();
 constructor(private db:ProjectDB,private workerPath:string,private publish:(type:string,payload:unknown)=>void,jobs?:CreationJobs){this.jobs=jobs??new CreationJobs(db,publish);this.jobs.register('audio',(command,turnId,signal)=>this.execute(GenerationSchema.parse(command),turnId,signal));}
 list(){return(this.db.db.prepare("SELECT json FROM library WHERE kind='generated_revision' ORDER BY rowid DESC").all() as {json:string}[]).map(r=>LibraryRevisionSchema.parse(JSON.parse(r.json)));}
 get(revisionId:string){const row=this.db.db.prepare("SELECT json FROM library WHERE id=? AND kind='generated_revision'").get(revisionId) as {json:string}|undefined;if(!row)throw new Error('Saved media revision not found.');return LibraryRevisionSchema.parse(JSON.parse(row.json));}
 recover(){this.jobs.recover();}
 resume(requestId:string){return this.jobs.resume(requestId);}
 cancel(requestId:string){this.jobs.cancel(requestId);}
 async close(){this.stopBindings();await this.jobs.close();}
 stopBindings(){this.stopped=true;clearTimeout(this.bindingTimer);}
 private storyBeats(){const t=this.db.timeline(),r=resolve(t,this.db.footage());return t.beats.flatMap(beat=>{const clips=r.clips.filter(c=>c.beatId===beat.id);return clips.length?[{id:beat.id,startSec:Math.min(...clips.map(c=>c.start)),durationSec:Math.max(...clips.map(c=>c.end))-Math.min(...clips.map(c=>c.start))}]:[];});}
 scheduleBindings(){
  if(this.stopped)return;clearTimeout(this.bindingTimer);
  this.bindingTimer=setTimeout(()=>{
   if(this.stopped||this.jobs.busy||this.db.getMeta('ai_status')==='running')return;
   try{const state=this.db.state({bounded:true});
   for(const music of state.timeline.music){
    if(!music.scoreRevisionId)continue;const revision=this.get(music.scoreRevisionId);if(!revision.document?.bindings.length)continue;
    const requestId=`binding:${state.versionId}:${revision.definitionId}:${revision.revisionId}`;if(this.bindingAttempts.has(requestId))continue;
    const bound=bindScore(revision.document,this.storyBeats());if(!bound.changedSections.length&&!bound.unresolved.length)continue;
    this.bindingAttempts.add(requestId);
    if(bound.unresolved.length){this.db.job(requestId,'score_binding','failed',0,'A score binding refers to a story beat that was removed. Edit the binding in Library.');this.publish('state',this.db.state({bounded:true}));continue;}
    const turnId=state.versions.find(v=>v.id===state.versionId)?.turnId??undefined;
    void this.generate({type:'edit_score',scoreId:revision.definitionId,revisionId:revision.revisionId,document:bound.score,requestId,expectedVersionId:state.versionId},turnId).catch(error=>this.publish('media.error',{message:error.message}));break;
   }}catch(error){this.publish('media.error',{message:(error as Error).message});}
  },300);
 }
 generate(raw:GenerationCommand,turnId?:string,signal?:AbortSignal):Promise<GenerationResult>{
  return this.jobs.run(GenerationSchema.parse(raw),turnId,signal) as Promise<GenerationResult>;
 }
 private async execute(command:GenerationCommand,turnId:string|undefined,signal:AbortSignal):Promise<GenerationResult>{
  let document:ScoreDocument|undefined,sound:SoundDesign|undefined,title:string,definitionId:string,presetId:string|undefined;
  const requestHash=createHash('sha256').update(command.requestId).digest('hex');
  if(command.type==='generate_music'){
   const preset=scoreCatalog.find(p=>p.id===command.presetId);if(!preset)throw new Error('Score preset not found.');
   definitionId=`score-${requestHash.slice(0,24)}`;title=preset.name;presetId=preset.id;
   document=arrangeScore({...preset,id:definitionId,title,durationSec:command.durationSec,key:0,intensity:command.intensity??.5,tempo:command.tempo??preset.tempo,instruments:command.instruments??['pad','bass','pluck','drums']});
  }else if(command.type==='create_score'){
   document=command.document;definitionId=document.id;title=document.title;
   if(this.db.db.prepare("SELECT 1 FROM library WHERE kind='generated_revision' AND json_extract(json,'$.definitionId')=? LIMIT 1").get(definitionId))throw new Error('This score ID already exists. Use edit_score to create its next revision.');
  }else if(command.type==='create_sfx'){
   sound=command.sound;definitionId=sound.id;title=sound.title;
  }else if(command.type==='edit_score'){
   const base=this.get(command.revisionId);if(base.definitionId!==command.scoreId||base.kind!=='score'||command.document.id!==command.scoreId)throw new Error('This score revision belongs to another definition.');
   document=ScoreSchema.parse(command.document);definitionId=document.id;title=document.title;presetId=base.presetId;
  }else{const preset=sfxCatalog.find(p=>p.id===command.presetId);if(!preset)throw new Error('Sound preset not found.');definitionId=preset.id;title=preset.name;presetId=preset.id;}
  if(document?.bindings.length){const bound=bindScore(document,this.storyBeats());if(bound.unresolved.length)throw new Error('A score binding refers to an unavailable story beat.');document=bound.score;}
  const revisionId=createHash('sha256').update(JSON.stringify({document,sound,presetId:document||sound?undefined:presetId,renderer:SCORE_RENDERER_VERSION})).digest('hex');
  const root=join(this.db.folder,'Media/Generated'),destination=join(root,revisionId);await mkdir(destination,{recursive:true});
  let rendered:RenderedScore|undefined;
  try{rendered=RenderedScoreSchema.parse(JSON.parse(await readFile(join(destination,'manifest.json'),'utf8')));if(rendered.rendererVersion!==SCORE_RENDERER_VERSION||await fingerprint(join(destination,'mix.wav'))!==rendered.sha256)rendered=undefined;else for(const stem of rendered.stems)if(await fingerprint(join(destination,stem.filename))!==stem.sha256){rendered=undefined;break;}}catch{rendered=undefined;}
  if(!rendered){
   const staging=join(root,`.staging-${randomUUID()}`);
   try{
    rendered=await renderProcedural(this.workerPath,{directory:staging,score:document,sound,sfxId:document||sound?undefined:presetId},signal,progress=>this.jobs.progress(command,progress));
    signal.throwIfAborted();for(const file of ['mix.wav',...rendered.stems.map(s=>s.filename),'manifest.json'])await rename(join(staging,file),join(destination,file));await rmdir(staging);
   }finally{const rel=relative(root,staging);if(rel&&!isAbsolute(rel)&&!rel.startsWith('..'))await rm(staging,{recursive:true,force:true});}
  }
  signal.throwIfAborted();const assetId=`a_gen_${revisionId.slice(0,24)}`,stemAssetIds=rendered.stems.map((s,n)=>({trackId:s.trackId,assetId:`${assetId}_stem_${n}`}));
  const revision:LibraryRevision={revisionId,definitionId,kind:document?'score':'sfx',title,presetId,document,sound,assetId,stemAssetIds,masterGain:rendered.masterGain,beats:rendered.beats,rendererVersion:SCORE_RENDERER_VERSION,createdAt:new Date().toISOString()};
  return this.db.db.transaction(()=>{
   const save=(id:string,path:string,hash:string,waveform:number[],role:'mix'|'stem',trackId?:string)=>this.db.saveAsset(AssetSchema.parse({id,filename:role==='mix'?title:`${title} - ${trackId}`,kind:'audio',durationSec:rendered!.durationSec,hasAudio:true,originalPath:path,fingerprint:hash,status:'ready',waveform,generated:{kind:document?'score':'sfx',definitionId,revisionId,rendererVersion:SCORE_RENDERER_VERSION,role,trackId}}));
   save(assetId,join(destination,'mix.wav'),rendered!.sha256,rendered!.waveform,'mix');for(let n=0;n<rendered!.stems.length;n++){const stem=rendered!.stems[n];save(stemAssetIds[n].assetId,join(destination,stem.filename),stem.sha256,stem.waveform,'stem',stem.trackId);}
   this.db.db.prepare('INSERT INTO library VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(revisionId,'generated_revision',JSON.stringify(revision));
   const timeline=this.db.timeline(),ops:Op[]=[];
   const current=command.expectedVersionId===this.db.head();
   if(document&&resolve(timeline,this.db.footage()).durationInFrames>0&&current){const matching=command.type==='edit_score'?timeline.music.filter(m=>m.scoreId===definitionId):[];
    if(matching.length)for(const music of matching)ops.push({type:'update_music',musicId:music.id,changes:{assetId,srcIn:0,srcOut:document.durationSec,scoreId:definitionId,scoreRevisionId:revisionId},reason:'Use revised score'});
    else ops.push({type:'add_music',music:{id:`music-${requestHash.slice(0,24)}`,assetId,srcIn:0,srcOut:document.durationSec,start:('start' in command&&command.start)||{kind:'project',at:'start',offsetSec:0},gainDb:('gainDb' in command?command.gainDb:undefined)??-18,duckUnderSpeechDb:12,fadeInSec:.3,fadeOutSec:1,reason:'Original procedural score',scoreId:definitionId,scoreRevisionId:revisionId},reason:'Add original score'});
   }
   if(!document&&resolve(timeline,this.db.footage()).durationInFrames>0&&current)ops.push({type:'add_item',item:{id:`sfx-${requestHash.slice(0,24)}`,type:'sfx',component:'audio',start:('start' in command&&command.start)||{kind:'project',at:'start',offsetSec:0},durationSec:rendered!.durationSec,source:{assetId,srcIn:0,srcOut:rendered!.durationSec},params:{gainDb:('gainDb' in command?command.gainDb:undefined)??-9},layer:Math.max(-1,...timeline.attached.filter(i=>i.type==='sfx').map(i=>i.layer))+1,reason:'Original procedural sound effect'},reason:'Add original sound effect'});
   const applied=ops.length?this.db.apply(ops,command.type==='edit_score'?'Revise original score':document?'Add original score':'Add original sound effect',`media:${command.requestId}`,command.expectedVersionId,turnId):undefined;
   const result:GenerationResult={assetId,revisionId,definitionId,placed:!!applied,versionId:applied?.versionId,...(!current?{warning:'The timeline changed while rendering. The media is saved in your library; read the current timeline before adding it.'}:!timeline.spine.length?{warning:'The media is saved. Add footage or an intentional visual to the timeline before placing it.'}:{})};
   // Asset registration, immutable revision, timeline ops and request receipt are atomic.
   this.jobs.commit(command,turnId,result);return result;
  })();
 }
}
