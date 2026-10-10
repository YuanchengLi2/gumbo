import {readFileSync,mkdirSync,copyFileSync,existsSync,writeFileSync,renameSync} from 'node:fs';
import {join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceDocumentSchema,type PublicationReceipt,type ProcessResult,type SourceChange} from '@dream/contracts';
import {AssetSchema,type Asset} from '@dream/footage';
import {resolve as resolveTimeline} from '@dream/timeline';
import type {ProjectDB} from '@dream/project-db';
import {digest,workspacePath} from '../../../packages/project-db/src/workspace-store';
import {timelineChanges} from '../../../packages/project-db/src/activity';
import {probe,fingerprint} from './media';
import {validateSceneSource,inlineLocalAssets} from './scene-source';

/** Candidate validation and immutable ingestion happen before the single SQLite commit. */
export async function publishWorkspace(db:ProjectDB,process:ProcessResult,turnId:string,ffprobe:string):Promise<PublicationReceipt|undefined>{
 if(process.status!=='complete'||process.exitCode!==0)throw new Error('Only a successful process can publish.');
 const replay=db.db.prepare('SELECT json FROM workspace_publications WHERE id=?').get(process.id) as any;if(replay)return JSON.parse(replay.json);
 const root=join(db.folder,'Workspace'),candidate=WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(workspacePath(root,'project.json'),'utf8'))),documentHash=digest(JSON.stringify(candidate));
 if(candidate.baseVersionId!==db.head())throw new Error(`The project changed: project.json is based on version ${candidate.baseVersionId}, but the published version is now ${db.head()}. Read context/published-project.json for the current timeline and baseVersionId, then reapply your change in project.json on top of it.`);
 if(candidate.timeline.id!==db.timeline().id)throw new Error('The document belongs to another project.');
 if(new Set(candidate.outputs.map(o=>o.id)).size!==candidate.outputs.length)throw new Error('Output IDs must be unique.');
 const outputs=new Map<string,Asset>(),assets=db.footage().assets;
 const sceneAsset=(sourcePath:string,name:string,size:{width:number;height:number;fps:number;durationInFrames:number})=>{
  const html=inlineLocalAssets(readFileSync(workspacePath(root,sourcePath),'utf8'),sourcePath,root);
  validateSceneSource(html);
  const hash=digest(JSON.stringify({html,width:size.width,height:size.height,fps:size.fps,frames:size.durationInFrames})),directory=join(db.folder,'Media/Generated',hash),target=join(directory,'scene.html');
  mkdirSync(directory,{recursive:true});if(!existsSync(target)){const temp=target+'.dream-write';writeFileSync(temp,html,'utf8');renameSync(temp,target);}
  if(readFileSync(target,'utf8')!==html)throw new Error('Scene copy failed verification.');
  return AssetSchema.parse({id:'code_'+hash,filename:name,kind:'video',originalPath:target,fingerprint:hash,durationSec:size.durationInFrames/size.fps,fps:size.fps,width:size.width,height:size.height,status:'ready',scene:{format:'html',revisionId:hash,durationInFrames:size.durationInFrames}});
 };
 for(const output of candidate.outputs){
  if(output.kind!=='scene'&&!output.path.replaceAll('\\','/').startsWith('output/'))throw new Error('Declare generated assets under output/.');
  const path=workspacePath(root,output.path);let asset:Asset;
  if(output.kind==='scene'){
   if(!output.width||!output.height||!output.fps||!output.durationInFrames)throw new Error('A live scene needs width, height, fps and durationInFrames.');
   asset=sceneAsset(output.path,output.id,{width:output.width,height:output.height,fps:output.fps,durationInFrames:output.durationInFrames});
  }else{
   const info=await probe(path,ffprobe);if(info.kind!==output.kind||!Number.isFinite(info.durationSec)||info.durationSec<=0)throw new Error(`Output ${output.id} is not valid ${output.kind} media.`);
   const hash=await fingerprint(path),directory=join(db.folder,'Media/Generated',hash),target=join(directory,'media'+extname(path).toLowerCase());mkdirSync(directory,{recursive:true});if(!existsSync(target))copyFileSync(path,target);
   if(await fingerprint(target)!==hash)throw new Error('Generated media copy failed verification.');
   asset=AssetSchema.parse({id:'code_'+hash,filename:output.id+extname(path),...info,originalPath:target,fingerprint:hash,status:'ready',playback:{ready:true,audio:info.hasAudio?'original':'none'}});
  }
  asset.creation={kind:'code',processId:process.id,outputId:output.id,...(output.kind==='scene'?{sourcePath:output.path}:{})};outputs.set('output:'+output.id,asset);
 }
 // Editing a scene's source and publishing must update the preview: a scene on the timeline whose file changed since it was
 // built is rebuilt from the current file with the same size and duration, and the timeline is pointed at the new build.
 const refreshed=new Map<string,Asset>();
 for(const assetId of new Set([...candidate.timeline.spine,...candidate.timeline.music,...candidate.timeline.attached.flatMap(i=>i.source?[i.source]:[])].map(c=>c.assetId))){
  const old=assets.find(a=>a.id===assetId),source=old?.creation?.sourcePath;
  if(!old?.scene||!source||!existsSync(workspacePath(root,source)))continue;
  const fresh=sceneAsset(source,old.filename,{width:old.width!,height:old.height!,fps:old.fps!,durationInFrames:old.scene.durationInFrames});
  if(fresh.id!==old.id){fresh.creation={kind:'code',processId:process.id,outputId:old.creation!.outputId,sourcePath:source};refreshed.set(assetId,fresh);}
 }
 const timeline=structuredClone(candidate.timeline),all=new Map([...assets,...outputs.values(),...refreshed.values()].map(a=>[a.id,a]));
 const bind=(clip:{assetId:string;srcIn:number;srcOut:number})=>{clip.assetId=outputs.get(clip.assetId)?.id??refreshed.get(clip.assetId)?.id??clip.assetId;const asset=all.get(clip.assetId);if(!asset)throw new Error(`Unknown asset ${clip.assetId}.`);if(clip.srcOut<=clip.srcIn||asset.kind!=='image'&&clip.srcOut>asset.durationSec+1/Math.max(asset.fps,30))throw new Error(`Source range exceeds ${asset.filename}.`);};
 timeline.spine.forEach(bind);timeline.music.forEach(bind);timeline.attached.forEach(item=>{if(item.source)bind(item.source);});
 const ids=[...timeline.spine,...timeline.attached,...timeline.music].map(i=>i.id);if(new Set(ids).size!==ids.length)throw new Error('Timeline item IDs must be unique.');
 const resolved=resolveTimeline(timeline,{...db.footage(),assets:[...all.values()]});if(!Number.isFinite(resolved.durationSec)||resolved.warnings.some(w=>w.code==='anchor_removed'))throw new Error('The timeline has invalid timing or missing anchors.');
 const snapshot=db.workspace.capture(root),previous=db.workspace.snapshot(db.head());
 if(JSON.stringify(timeline)===JSON.stringify(db.timeline())&&snapshot.hash===previous)return;
 const changes=timelineChanges(db.timeline(),timeline,id=>all.get(id)?.filename??id),oldFiles=previous?db.workspace.files(previous):{};
 const files:SourceChange[]=[];
 for(const path of new Set([...Object.keys(oldFiles),...Object.keys(snapshot.files)]))if(oldFiles[path]!==snapshot.files[path]){const before=oldFiles[path]?Buffer.from(db.blobs.get(oldFiles[path]),'base64').toString('utf8'):'',after=snapshot.files[path]?Buffer.from(db.blobs.get(snapshot.files[path]),'base64').toString('utf8'):'';files.push({path,beforeHash:oldFiles[path],afterHash:snapshot.files[path],before:before.slice(0,6000),after:after.slice(0,6000),truncated:before.length>6000||after.length>6000});}
 return db.db.transaction(()=>{
  if(db.head()!==candidate.baseVersionId)throw new Error('The project changed while outputs were being inspected.');
  for(const asset of [...outputs.values(),...refreshed.values()])db.saveAsset(asset);
  const versionId=db.writeVersion(timeline,db.head(),changes.slice(0,3).join('; ')||'Saved project updates',turnId),branch=db.getMeta('branch')??'main';
  // Store the canonical document with immutable IDs so collect/undo never need
  // a previous run's scratch outputs to rebuild the edit.
  const canonical=JSON.stringify({...candidate,baseVersionId:versionId,timeline,outputs:[]},null,2);
  snapshot.files['project.json']=db.blobs.put(Buffer.from(canonical).toString('base64'));
  const documentChange=files.find(file=>file.path==='project.json');if(documentChange){documentChange.afterHash=snapshot.files['project.json'];documentChange.after=canonical.slice(0,6000);documentChange.truncated=documentChange.before.length>=6000||canonical.length>6000;}
  snapshot.hash=db.blobs.put(JSON.stringify(snapshot.files));
  db.workspace.associate(versionId,snapshot.hash);db.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(versionId,branch);db.db.prepare('DELETE FROM actions WHERE branch_id=? AND undone=1').run(branch);
  db.workspace.queueRestore(versionId);
  const last=db.db.prepare('SELECT * FROM actions WHERE branch_id=? ORDER BY seq DESC LIMIT 1').get(branch) as any;
  if(last?.turn_id===turnId)db.db.prepare('UPDATE actions SET after_id=? WHERE id=?').run(versionId,last.id);else db.db.prepare('INSERT INTO actions(id,branch_id,before_id,after_id,turn_id,seq) VALUES(?,?,?,?,?,?)').run(randomUUID(),branch,candidate.baseVersionId,versionId,turnId,(last?.seq??0)+1);
  const receipt:PublicationReceipt={id:process.id,versionId,baseVersionId:candidate.baseVersionId,sourceSnapshot:snapshot.hash,processId:process.id,assets:[...outputs.values()].map(a=>a.id),...(refreshed.size?{refreshed:[...refreshed.values()].map(a=>a.id)}:{}),changes,files,documentHash};
  db.db.prepare('INSERT INTO workspace_publications VALUES(?,?,?)').run(process.id,process.commandHash,JSON.stringify(receipt));db.recordFileChanges(turnId,process.id,changes);db.event('workspace.published',receipt);return receipt;
 })();
}
