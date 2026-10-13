import {readFileSync,mkdirSync,copyFileSync,existsSync,writeFileSync,renameSync} from 'node:fs';
import {join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceDocumentSchema,lineDelta,type PublicationReceipt,type ProcessResult,type SourceChange} from '@dream/contracts';
import {AssetSchema,type Asset} from '@dream/footage';
import {resolve as resolveTimeline} from '@dream/timeline';
import type {ProjectDB} from '@dream/project-db';
import {digest,workspacePath,replaceFileSync} from '../../../packages/project-db/src/workspace-store';
import {timelineChanges} from '../../../packages/project-db/src/activity';
import {probe,fingerprint} from './media';
import {validateSceneSource,inlineLocalAssets} from './scene-source';
import {compileScene,isEngineScene,type CompileError} from './engine-compile';
import {soundOutput,inProcessRenderer,type AudioRenderer} from './sound-outputs';
import {documentErrors,anchorProblem} from './document-errors';

/** Compile errors as the agent sees them: one line per error with its file position. */
export const formatCompileErrors=(errors:CompileError[])=>'The scene code does not compile:\n'+errors.slice(0,12).map(e=>`${e.file}:${e.line}:${e.column} ${e.text}`).join('\n');
/** Copies a compiled scene's resources into the project's content-addressed store and records them beside the bundle. */
export function storeEngineScene(projectFolder:string,root:string,compiled:{bundle:string;map:string;resources:Record<string,string>},directory:string):{bundlePath:string;files:Record<string,string>;storeDir:string}{
 const store=join(projectFolder,'Media/Engine/files'),files:Record<string,string>={};mkdirSync(store,{recursive:true});mkdirSync(directory,{recursive:true});
 for(const [key,rel] of Object.entries(compiled.resources)){const bytes=readFileSync(join(root,rel)),hash=digest(bytes),target=join(store,hash);if(!existsSync(target))replaceFileSync(target,bytes);files[key]=hash;}
 const write=(name:string,text:string)=>{const target=join(directory,name);if(existsSync(target)&&readFileSync(target,'utf8')===text)return;replaceFileSync(target,text);};
 write('scene.js',compiled.bundle);if(compiled.map)write('scene.js.map',compiled.map);write('resources.json',JSON.stringify({files}));
 return{bundlePath:join(directory,'scene.js'),files,storeDir:store};
}

/** Candidate validation and immutable ingestion happen before the single SQLite commit. */
export async function publishWorkspace(db:ProjectDB,process:ProcessResult,turnId:string,ffprobe:string,options:{renderAudio?:AudioRenderer;signal?:AbortSignal}={}):Promise<PublicationReceipt|undefined>{
 if(process.status!=='complete'||process.exitCode!==0)throw new Error('Only a successful process can publish.');
 const replay=db.db.prepare('SELECT json FROM workspace_publications WHERE id=?').get(process.id) as any;if(replay)return JSON.parse(replay.json);
 const root=join(db.folder,'Workspace');let raw:unknown;try{raw=JSON.parse(readFileSync(workspacePath(root,'project.json'),'utf8'));}catch(error){throw new Error('project.json is not valid JSON: '+(error as Error).message);}
 const parsed=WorkspaceDocumentSchema.safeParse(raw);if(!parsed.success)throw new Error(documentErrors(parsed.error));const candidate=parsed.data;
 if(candidate.baseVersionId!==db.head())throw new Error(`The project changed: project.json is based on version ${candidate.baseVersionId}, but the published version is now ${db.head()}. Read context/published-project.json for the current timeline and baseVersionId, then reapply your change in project.json on top of it.`);
 // A document based on this project's current version is this project's, so a different timeline ID can only be one the
 // agent made up while rewriting project.json; the project keeps its own.
 if(candidate.timeline.id!==db.timeline().id)candidate.timeline.id=db.timeline().id;
 const documentHash=digest(JSON.stringify(candidate));
 if(new Set(candidate.outputs.map(o=>o.id)).size!==candidate.outputs.length)throw new Error('Output IDs must be unique.');
 const outputs=new Map<string,Asset>(),assets=db.footage().assets;
 type Size={width:number;height:number;fps:number;durationInFrames:number};type EngineOptions={props?:Record<string,unknown>;transparent?:boolean;assets?:string[];music?:Record<string,string>};
 // Engine scenes (.tsx/.ts/.jsx/.js) compile into one bundle for the scene engine; nothing runs here.
 const engineAsset=async(sourcePath:string,name:string,size:Size,extra:EngineOptions)=>{
  const compiled=await compileScene(root,{entry:sourcePath,mode:'publish'});if(compiled.errors.length)throw new Error(formatCompileErrors(compiled.errors));
  const revision=digest(JSON.stringify({scene:compiled.hash,...size,props:extra.props??null,transparent:!!extra.transparent,music:extra.music??{}}));
  const target=storeEngineScene(db.folder,root,compiled,join(db.folder,'Media/Generated',revision)).bundlePath;
  return AssetSchema.parse({id:'code_'+revision,filename:name,kind:'video',originalPath:target,fingerprint:revision,durationSec:size.durationInFrames/size.fps,fps:size.fps,width:size.width,height:size.height,status:'ready',scene:{format:'engine',revisionId:revision,durationInFrames:size.durationInFrames,engine:{version:compiled.version,chunks:compiled.chunks,props:extra.props,assets:[...new Set([...compiled.assetRefs,...extra.assets??[]])],music:extra.music??{},files:Object.keys(compiled.resources).length,transparent:!!extra.transparent}}});
 };
 const sceneAsset=async(sourcePath:string,name:string,size:Size,extra:EngineOptions={})=>{
  if(isEngineScene(sourcePath))return engineAsset(sourcePath,name,size,extra);
  const html=inlineLocalAssets(readFileSync(workspacePath(root,sourcePath),'utf8'),sourcePath,root);
  validateSceneSource(html);
  const hash=digest(JSON.stringify({html,width:size.width,height:size.height,fps:size.fps,frames:size.durationInFrames})),directory=join(db.folder,'Media/Generated',hash),target=join(directory,'scene.html');
  mkdirSync(directory,{recursive:true});if(!existsSync(target))replaceFileSync(target,html);
  if(readFileSync(target,'utf8')!==html)throw new Error('Scene copy failed verification.');
  return AssetSchema.parse({id:'code_'+hash,filename:name,kind:'video',originalPath:target,fingerprint:hash,durationSec:size.durationInFrames/size.fps,fps:size.fps,width:size.width,height:size.height,status:'ready',scene:{format:'html',revisionId:hash,durationInFrames:size.durationInFrames}});
 };
 // Sound first, so scenes can follow the beats of music published with them.
 const ordered=[...candidate.outputs].sort((a,b)=>Number(a.kind==='scene')-Number(b.kind==='scene'));
 for(const output of ordered){
  if(output.kind==='music'||output.kind==='sfx'){const asset=await soundOutput(db.folder,root,{id:output.id,path:output.path,kind:output.kind},options.renderAudio??inProcessRenderer,options.signal??new AbortController().signal);asset.creation={kind:'code',processId:process.id,outputId:output.id};outputs.set('output:'+output.id,asset);continue;}
  // The message names the output and both ways to fix it, so the agent corrects the declaration instead of guessing.
  if(output.kind!=='scene'&&!output.path.replaceAll('\\','/').startsWith('output/'))throw new Error(`Output "${output.id}" is declared as kind "${output.kind}" at ${output.path}. A file of kind ${output.kind} must be written under output/ (for example output/${output.path.replaceAll('\\','/').split('/').pop()}). If ${output.path} is a scene to play live (.tsx, .ts, .jsx, .js or .html), declare it with kind "scene" instead.`);
  const path=workspacePath(root,output.path);let asset:Asset;
  if(output.kind==='scene'){
   // Engine scenes default to the project's frame size and rate; every scene needs its length.
   const settings=candidate.timeline.settings,engine=isEngineScene(output.path),width=output.width??(engine?settings.width:undefined),height=output.height??(engine?settings.height:undefined),fps=output.fps??(engine?settings.fps:undefined);
   if(!width||!height||!fps||!output.durationInFrames)throw new Error('A scene output needs durationInFrames'+(engine?'':', width, height and fps')+'.');
   const music=Object.fromEntries((output.music??[]).map(name=>{const asset=outputs.get('output:'+name)??assets.find(a=>a.id===name);if(asset?.generated?.kind!=='score')throw new Error(`Scene ${output.id} lists music "${name}", which is not a music output or score asset.`);return[name,asset.id];}));
   asset=await sceneAsset(output.path,output.id,{width,height,fps,durationInFrames:output.durationInFrames},{props:output.props,transparent:output.transparent,assets:output.assets,music});
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
  // Engine scenes recompile from all their inputs, so a change to any imported helper or resource refreshes them too.
  const fresh=await sceneAsset(source,old.filename,{width:old.width!,height:old.height!,fps:old.fps!,durationInFrames:old.scene.durationInFrames},{props:old.scene.engine?.props,transparent:old.scene.engine?.transparent,assets:old.scene.engine?.assets,music:old.scene.engine?.music});
  if(fresh.id!==old.id){fresh.creation={kind:'code',processId:process.id,outputId:old.creation!.outputId,sourcePath:source};refreshed.set(assetId,fresh);}
 }
 const timeline=structuredClone(candidate.timeline),all=new Map([...assets,...outputs.values(),...refreshed.values()].map(a=>[a.id,a]));
 const bind=(clip:{assetId:string;srcIn:number;srcOut:number})=>{clip.assetId=outputs.get(clip.assetId)?.id??refreshed.get(clip.assetId)?.id??clip.assetId;const asset=all.get(clip.assetId);if(!asset)throw new Error(`Unknown asset ${clip.assetId}.`);if(clip.srcOut<=clip.srcIn||asset.kind!=='image'&&clip.srcOut>asset.durationSec+1/Math.max(asset.fps,30))throw new Error(`Source range exceeds ${asset.filename}.`);};
 timeline.spine.forEach(bind);timeline.music.forEach(bind);timeline.attached.forEach(item=>{if(item.source)bind(item.source);});
 const ids=[...timeline.spine,...timeline.attached,...timeline.music].map(i=>i.id);if(new Set(ids).size!==ids.length)throw new Error('Timeline item IDs must be unique.');
 const resolved=resolveTimeline(timeline,{...db.footage(),assets:[...all.values()]});const lost=resolved.warnings.filter(w=>w.code==='anchor_removed');
 if(!Number.isFinite(resolved.durationSec)||lost.length)throw new Error(lost.length?'These timeline items cannot be placed:\n'+lost.slice(0,8).map(w=>anchorProblem(timeline,(w as any).itemId??'')).join('\n'):'The timeline has invalid timing.');
 const snapshot=db.workspace.capture(root),previous=db.workspace.snapshot(db.head());
 if(JSON.stringify(timeline)===JSON.stringify(db.timeline())&&snapshot.hash===previous)return;
 const changes=timelineChanges(db.timeline(),timeline,id=>all.get(id)?.filename??id),oldFiles=previous?db.workspace.files(previous):{};
 const files:SourceChange[]=[];
 for(const path of new Set([...Object.keys(oldFiles),...Object.keys(snapshot.files)]))if(oldFiles[path]!==snapshot.files[path]){const before=oldFiles[path]?Buffer.from(db.blobs.get(oldFiles[path]),'base64').toString('utf8'):'',after=snapshot.files[path]?Buffer.from(db.blobs.get(snapshot.files[path]),'base64').toString('utf8'):'';files.push({path,beforeHash:oldFiles[path],afterHash:snapshot.files[path],...lineDelta(before,after)});}
 return db.db.transaction(()=>{
  if(db.head()!==candidate.baseVersionId)throw new Error('The project changed while outputs were being inspected.');
  for(const asset of [...outputs.values(),...refreshed.values()])db.saveAsset(asset);
  const versionId=db.writeVersion(timeline,db.head(),changes.slice(0,3).join('; ')||'Saved project updates',turnId),branch=db.getMeta('branch')??'main';
  // Store the canonical document with immutable IDs so collect/undo never need
  // a previous run's scratch outputs to rebuild the edit.
  const canonical=JSON.stringify({...candidate,baseVersionId:versionId,timeline,outputs:[]},null,2);
  snapshot.files['project.json']=db.blobs.put(Buffer.from(canonical).toString('base64'));
  const documentChange=files.find(file=>file.path==='project.json');if(documentChange){documentChange.afterHash=snapshot.files['project.json'];Object.assign(documentChange,lineDelta(documentChange.beforeHash?Buffer.from(db.blobs.get(documentChange.beforeHash),'base64').toString('utf8'):'',canonical));}
  snapshot.hash=db.blobs.put(JSON.stringify(snapshot.files));
  db.workspace.associate(versionId,snapshot.hash);db.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(versionId,branch);db.db.prepare('DELETE FROM actions WHERE branch_id=? AND undone=1').run(branch);
  db.workspace.queueRestore(versionId);
  const last=db.db.prepare('SELECT * FROM actions WHERE branch_id=? ORDER BY seq DESC LIMIT 1').get(branch) as any;
  if(last?.turn_id===turnId)db.db.prepare('UPDATE actions SET after_id=? WHERE id=?').run(versionId,last.id);else db.db.prepare('INSERT INTO actions(id,branch_id,before_id,after_id,turn_id,seq) VALUES(?,?,?,?,?,?)').run(randomUUID(),branch,candidate.baseVersionId,versionId,turnId,(last?.seq??0)+1);
  const receipt:PublicationReceipt={id:process.id,versionId,baseVersionId:candidate.baseVersionId,sourceSnapshot:snapshot.hash,processId:process.id,assets:[...outputs.values()].map(a=>a.id),...(refreshed.size?{refreshed:[...refreshed.values()].map(a=>a.id)}:{}),changes,files,documentHash};
  db.db.prepare('INSERT INTO workspace_publications VALUES(?,?,?)').run(process.id,process.commandHash,JSON.stringify(receipt));db.recordFileChanges(turnId,process.id,changes);db.event('workspace.published',receipt);return receipt;
 })();
}
