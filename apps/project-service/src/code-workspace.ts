import {bundleScene} from './bundle-scene';
import {liveSceneGuide} from './live-scene-guide';
import {activeDecisions} from '../../../packages/orchestrator/src/project-memory';
import {searchWorkspace} from './workspace-search';
import {workspaceEnvironment} from './workspace-environment';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,renameSync,copyFileSync,unlinkSync} from 'node:fs';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join,dirname,basename,relative,isAbsolute} from 'node:path';
import type {ProjectDB} from '@dream/project-db';
import type {CodeWorkspacePort,ProcessRunner,ProcessResult,FileService,ReviewRenderer,WorkerScope} from '@dream/contracts';
import {WorkspaceDocumentSchema} from '@dream/contracts';
import {resolve as resolveTimeline} from '@dream/timeline';
import {digest,workspacePath,authoredFiles} from '../../../packages/project-db/src/workspace-store';
import {contentHash} from '../../../packages/project-db/src/blob-store';
import {withinScopes,normalizeScope} from '../../../packages/orchestrator/src/code-tools';
import {WorkspaceIndex} from '../../../packages/project-db/src/workspace-index';
import {ProjectContext} from '../../../packages/orchestrator/src/context';
import {timelineOutline} from '../../../packages/orchestrator/src/timeline-outline';
import {mapLines,usableUntil,type Asset,type Shot} from '@dream/footage';
import {FileApprovalRequired} from '../../../packages/orchestrator/src/file-tools';
import {toolActivity,fileChanges} from '../../../packages/orchestrator/src/activity';
import {inspectMedia} from './media-evidence';
import {jpeg} from './source-frames';
import {captureOrder} from '../../../packages/orchestrator/src/media-context';
import type {ComputerStatus} from '@dream/contracts';
import {publishWorkspace,storeEngineScene} from './code-publication';
import {compileScene,isEngineScene} from './engine-compile';
import {importResources} from './resource-import';
import {applyTimelineActions} from './timeline-actions';
import {fetchPage} from './web-fetch';
import {workerRenderer} from './sound-outputs';
import {sfxCatalog,describeScore,SoundDesignSchema} from '@dream/procedural-media';
import {ENGINE_VERSION,MODULES} from '../../../packages/scene-engine/src/index';
import type {TimelineDocument} from '@dream/timeline';
import {prepareProjectPackages} from './project-packages';

/** What the agent can use without building anything: the scene engine, sound written as code, and commands for packages. */
export const engineCapabilities=()=>({engine:{version:ENGINE_VERSION,modules:Object.keys(MODULES).filter(name=>!/^(d3-|three\/addons|@remotion\/transitions\/|react\/)/.test(name)),fonts:['Inter','Roboto','Montserrat','Poppins','Oswald','Bebas Neue','Playfair Display','Lora','Space Grotesk','JetBrains Mono','Press Start 2P']},music:{format:'src/music/<name>.score.json (notation or full score document)'},sfx:{format:'src/sfx/<name>.sfx.json or preset:<name>',presets:sfxCatalog.map(p=>p.name)},voiceover:false,commands:true});
const workspaceReadme=['# Dream workspace','','Scenes are React components in src/ that the Dream scene engine runs; music and sound effects are score and sound files in src/music/ and src/sfx/. Declare them as outputs and place them on the timeline as output:<id> with edit_timeline, which also makes every other timeline change; the engine reference in your instructions has a complete example of every timeline item.','','check_outputs compiles scenes and checks score files as drafts the user can see; publish_project compiles and publishes to the live player. Nothing renders until Export.','','Files from the computer go into resources/ with import_resources. Installed npm packages are bundled into scenes. Context files are refreshed from Dream.',''].join('\n');
export class CodeWorkspace implements CodeWorkspacePort {
 readonly root:string;readonly index:WorkspaceIndex;
 // Re-sent to the agent only when it changes, so it excludes volatile counters and the agent's own task list.
 currentContext(){const {indexRevision:_revision,...overview}=new ProjectContext(this.db).overview() as any;let turnId:string|undefined;try{turnId=JSON.parse(this.db.getMeta('pending_request')??'null')?.turnId;}catch{}const sceneErrors=this.sceneErrors(turnId,{changedOnly:false});return{...overview,media:this.mediaContext(),decisions:activeDecisions(this.db),...(sceneErrors.length?{sceneErrors}:{})};}
 snapshot(){const {indexRevision:_revision,recentDirection:_direction,...overview}=new ProjectContext(this.db).overview() as any;return{overview,timeline:timelineOutline(this.db.timeline(),this.db.footage()),projectNotes:(this.db.getMeta('preferences')??'').slice(0,1600)||undefined,media:this.mediaContext(),capabilities:engineCapabilities(),computer:this.computerContext(),decisions:activeDecisions(this.db),projectDocument:'project.json'};}
 readContext(paths:string[],maxCharacters:number){
  const files:{path:string;text:string;truncated:boolean}[]=[];let left=maxCharacters;
  for(const path of paths){if(left<=0)break;try{const text=readFileSync(workspacePath(this.root,path),'utf8');files.push({path,text:text.slice(0,left),truncated:text.length>left});left-=Math.min(text.length,left);}catch{files.push({path,text:'(not found)',truncated:false});}}
  return files;
 }
 private sceneRevisions(timeline:TimelineDocument){const assets=new Map(this.db.footage().assets.map(a=>[a.id,a]));return[...timeline.spine.map(c=>c.assetId),...timeline.attached.flatMap(i=>i.source?[i.source.assetId]:[])].map(id=>assets.get(id)).filter(a=>a?.scene?.format==='engine').map(a=>a!.scene!.revisionId);}
 /** Errors reported by scenes on the timeline (by default only those changed in this request, published since it
  * started) and by this request's current drafts. The project state shows all of them; finishing checks the changed ones. */
 sceneErrors(turnId?:string,options:{changedOnly?:boolean}={}){
  const start=this.db.getMeta('turn_start_version'),before=new Set(options.changedOnly!==false&&start?this.sceneRevisions(this.db.timeline(start)):[]),revisions=this.sceneRevisions(this.db.timeline()).filter(r=>!before.has(r));
  const drafts=turnId?Object.values(JSON.parse(this.db.getMeta('turn-drafts:'+turnId)??'{}') as Record<string,string>):[];
  const names=new Map(this.db.footage().assets.map(a=>[a.scene?.revisionId,a.filename]));
  return this.db.sceneErrors({revisions,drafts}).map(e=>({scene:e.draft?`draft ${e.draft.slice(0,8)}`:names.get(e.revisionId)??e.assetId??'scene',assetId:e.assetId,location:e.location,message:e.message}));
 }
 private queue:Promise<unknown>=Promise.resolve();
 /** Parallel workers share one workspace: commands and publication run one at a time (dependency installs, lockfiles, project.json). */
 private exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=this.queue.then(work,work);this.queue=next.catch(()=>{});return next;}
 async preparePackages(signal:AbortSignal){await this.initialize();await prepareProjectPackages(this.db,this.options.run,this.publishEvent,signal);this.refreshContext();this.db.setMeta('workspace_python_packages',JSON.stringify(workspaceEnvironment(this.root).pythonPackages));this.db.workspace.associate(this.db.head(),this.db.workspace.capture().hash);}
 constructor(private db:ProjectDB,private options:{run:ProcessRunner;ffmpeg:string;ffprobe:string;audioWorker?:string;files?:FileService;ensureTranscript?:(assetId:string,signal:AbortSignal)=>Promise<void>;renderReview?:ReviewRenderer;importSources?:(paths:string[],requestId:string,signal:AbortSignal)=>Promise<any>;importMany?:(paths:string[],requestId:string,copy:boolean|undefined,signal:AbortSignal)=>Promise<{permissionRequired?:true;results?:({asset:any}|{path:string;error:string})[]}>},private publishEvent:(type:string,payload:any)=>void){this.root=join(db.folder,'Workspace');this.index=new WorkspaceIndex(db,this.root);}
 private computer?:ComputerStatus;
 /** What the agent knows about the user's computer: whether access is allowed, where new media usually lands, and the local date and time zone that "today" refers to. */
 private computerContext(){const clock={now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};return this.computer?.access?{access:true,...clock,mediaFolders:(this.computer.folders??[]).filter(f=>f.exists).map(f=>({name:f.name,path:f.path,...(f.removable?{removable:true}:{})}))}:{access:false,...clock,note:'find_media and import_media ask the user to allow computer access when they are first used.'};}
 async initialize(){
  try{const status=await this.options.files?.({action:'computer_status'});if(status&&'access'in status)this.computer=status as ComputerStatus;}catch{}
  this.db.workspace.restorePending();this.db.workspace.syncPublishedDocument();for(const dir of ['src','output','context/transcripts','.logs','.cache'])mkdirSync(join(this.root,dir),{recursive:true});
  if(!existsSync(join(this.root,'project.json'))){this.write('project.json',JSON.stringify({format:'dream-workspace',version:1,baseVersionId:this.db.head(),timeline:this.db.timeline(),outputs:[]},null,2));this.write('package.json',JSON.stringify({name:'dream-project',private:true,type:'module',scripts:{}},null,2));this.write('requirements.txt','');this.write('README.md',workspaceReadme);}
  if(!this.db.getMeta('workspace_sources_migrated')){
   for(const row of this.db.db.prepare("SELECT id,json FROM library WHERE kind='visual_revision'").all() as {id:string;json:string}[]){const revision=JSON.parse(row.json),modules=revision.definition?.source?.modules??{};for(const [path,hash] of Object.entries(modules)){this.write(`src/legacy/${digest(row.id).slice(0,16)}/${path}`,this.db.blobs.get(String(hash)));}}
   this.db.setMeta('workspace_sources_migrated','1');
  }
  // Projects from before the scene engine carry a README that points at the retired HTML scene guide.
  const readme=join(this.root,'README.md');if(existsSync(readme)&&readFileSync(readme,'utf8').includes('context/live-scenes.md'))this.write('README.md',workspaceReadme);
  this.refreshContext();if(!this.db.workspace.snapshot(this.db.head()))this.db.workspace.associate(this.db.head(),this.db.workspace.capture().hash);
 }
 // Media is listed in capture order when known, so "in the order I shot it" needs no extra lookups.
 /** A source's footage map for the agent: what its shots show and what is wrong with them, or that it is not analyzed yet. */
 private footageMapEntry(asset:Asset,shots:Shot[],limit:number){
  if(asset.kind==='audio'||asset.scene||asset.generated)return{};
  const map=asset.footageMap;if(!map)return{map:'Not analyzed yet: look at a range with view_media before choosing it.'};
  const until=usableUntil(asset,shots),ranges=(list:[number,number][])=>list.map(([a,b])=>`${a.toFixed(1)}-${b.toFixed(1)}s`);
  return{map:{...(map.summary?{summary:map.summary}:{}),shots:mapLines(asset,shots,limit),...(map.frozen.length?{frozen:ranges(map.frozen)}:{}),...(map.black.length?{black:ranges(map.black)}:{}),...(until<asset.durationSec-.5?{usableUntilSec:until}:{}),...(map.status==='signals'?{note:'Measured only; the shots were not described.'}:{})}};
 }
 mediaContext(){let notes:Record<string,string>={};try{notes=JSON.parse(this.db.getMeta('source-notes')??'{}');}catch{}const footage=this.db.footage(),visual=footage.assets.filter(a=>a.kind!=='audio'&&!a.scene&&!a.generated).length,perSource=Math.max(3,Math.min(12,Math.floor(150/Math.max(1,visual))));return captureOrder(footage.assets).map(asset=>({assetId:asset.id,filename:asset.filename,kind:asset.kind,durationSec:asset.durationSec,...(asset.capturedAt?{capturedAt:asset.capturedAt}:{}),...this.footageMapEntry(asset,footage.shots,perSource),...(notes[asset.id]?{seen:notes[asset.id]}:{}),path:relative(this.db.folder,asset.originalPath).replaceAll('\\','/').startsWith('Media/')?relative(this.root,asset.originalPath).replaceAll('\\','/'):`../Sources/${asset.id}/${basename(asset.originalPath)}`,transcript:asset.hasAudio?{status:(this.db.db.prepare("SELECT status FROM jobs WHERE asset_id=? AND step='transcription'").get(asset.id) as any)?.status??'not_started',wordCount:(this.db.db.prepare("SELECT COUNT(*) AS n FROM index_records WHERE kind='words' AND json_extract(json,'$.assetId')=?").get(asset.id) as any).n,readWith:'read_transcript'}:undefined}));}
 private refreshContext(){
  const footage=this.db.footage();this.write('context/assets.json',JSON.stringify(captureOrder(footage.assets).map(a=>({id:a.id,filename:a.filename,kind:a.kind,durationSec:a.durationSec,hasAudio:a.hasAudio,capturedAt:a.capturedAt,width:a.width,height:a.height,fps:a.fps,source:a.source?.path,path:relative(this.db.folder,a.originalPath).replaceAll('\\','/').startsWith('Media/')?relative(this.root,a.originalPath).replaceAll('\\','/'):`../Sources/${a.id}/${basename(a.originalPath)}`,sequence:a.sequence?{fps:a.sequence.fps,frameCount:a.sequence.frameCount,pattern:'%06d.png'}:undefined})),null,2));
  for(const asset of footage.assets)this.write(`context/transcripts/${asset.id}.json`,JSON.stringify({coverage:this.db.loadState('speech-coverage:'+asset.id)??null,words:footage.words.filter(w=>w.assetId===asset.id)}));
  this.write('context/decisions.json',JSON.stringify(this.db.db.prepare('SELECT scope,text FROM project_decisions WHERE active=1').all()));
  this.write('context/published-project.json',JSON.stringify({format:'dream-workspace',version:1,baseVersionId:this.db.head(),timeline:this.db.timeline(),outputs:[]},null,2));
  this.write('context/environment.json',JSON.stringify(workspaceEnvironment(this.root),null,2));
  // The HTML scene guide only matters to the legacy bundling workflow (advanced tools).
  if(process.env.DREAM_AGENT_ADVANCED_TOOLS==='1')this.write('context/live-scenes.md',liveSceneGuide);
  this.write('context/project-schema.json',JSON.stringify(WorkspaceDocumentSchema.toJSONSchema(),null,2));
 }
 private write(path:string,text:string){const target=workspacePath(this.root,path);mkdirSync(dirname(target),{recursive:true});const temp=target+'.dream-write';writeFileSync(temp,text,'utf8');renameSync(temp,target);return{path,hash:digest(text)};}
 // The authored files by name, without excerpts: search and read_file open the code a request actually needs.
 context(query:string){const found=this.index.search(query,6),selected={files:found.files,note:'Authored files; search finds code by content and read_file opens it.'};this.db.event('workspace.context',{availableCharacters:found.availableCharacters,files:found.files.length});
  // The request's attached media and timeline selection tell the agent what "my clip" or "this" refers to.
  let pending:{selection?:string[];assetIds?:string[]}={};try{pending=JSON.parse(this.db.getMeta('pending_request')??'{}');}catch{}
  return{capabilities:engineCapabilities(),computer:this.computerContext(),workspace:'Workspace',workspaceFolder:this.root,baseVersionId:this.db.head(),project:new ProjectContext(this.db).initial(query,pending.selection??[],pending.assetIds??[]),source:selected,media:this.mediaContext(),environment:workspaceEnvironment(this.root),projectDocument:'project.json',schema:'context/project-schema.json'};}
 private async sources(signal:AbortSignal){
  const root=join(this.db.folder,'Sources');mkdirSync(root,{recursive:true});
  for(const asset of this.db.footage().assets){signal.throwIfAborted();if(!existsSync(asset.originalPath))continue;
   if(relative(this.db.folder,asset.originalPath).replaceAll('\\','/').startsWith('Media/'))continue;
   const local=relative(this.db.folder,asset.originalPath);if(local.startsWith('..')||/^[A-Za-z]:/.test(local)){if(!this.options.files)throw new Error('Source access is unavailable.');const allowed=await this.options.files({action:'authorize_import',paths:[asset.originalPath]},signal);if('permissionRequired'in allowed)throw new FileApprovalRequired();}
   const destination=join(root,asset.id);mkdirSync(destination,{recursive:true});const target=join(destination,basename(asset.originalPath));if(!existsSync(target))copyFileSync(asset.originalPath,target);
   if(asset.sequence)for(let n=0;n<asset.sequence.frameCount;n++){const name=String(n).padStart(6,'0')+'.png',output=join(destination,name);if(!existsSync(output))copyFileSync(join(asset.sequence.directory,name),output);}
  }
 }
 /** Authored files that differ from the published head's source snapshot. Completion requires none. */
 unpublishedChanges(){const hash=this.db.workspace.snapshot(this.db.head()),published:Record<string,string>=hash?this.db.workspace.files(hash):{},current:Record<string,string>={};for(const path of authoredFiles(this.root))current[path]=contentHash(readFileSync(workspacePath(this.root,path)).toString('base64'));return[...new Set([...Object.keys(published),...Object.keys(current)])].filter(path=>published[path]!==current[path]).sort();}
 async execute(name:string,input:any,callId:string,turnId:string,signal:AbortSignal,scope?:WorkerScope):Promise<any>{
  signal.throwIfAborted();this.db.workspace.restorePending();
  if(input.scope==='computer'&&input.path&&input.path!=='.'&&!isAbsolute(input.path))input={...input,scope:name==='search'?'project':'workspace'};
  if(name==='list_files'){
   if(input.scope==='computer'){if(!this.options.files)throw new Error('Computer file access is unavailable.');const result=await this.options.files({action:'list',path:input.path==='.'?'':input.path,cursor:input.cursor},signal);if('permissionRequired'in result)throw new FileApprovalRequired();return result;}
   const path=workspacePath(this.root,input.path??'.');return readdirSync(path,{withFileTypes:true}).filter(f=>!f.isSymbolicLink()).slice(input.offset??0,(input.offset??0)+200).map(f=>({name:f.name,kind:f.isDirectory()?'directory':'file'}));
  }
  if(name==='search'){if(input.scope==='computer'){if(!this.options.files)throw new Error('Computer file access is unavailable.');const result=await this.options.files({action:'search',query:input.query,path:input.path} as any,signal);if('permissionRequired'in result)throw new FileApprovalRequired();return result;}this.refreshContext();if(input.path)return searchWorkspace(this.root,input.path,input.query);return{source:this.index.search(input.query),project:new ProjectContext(this.db).search(input.query,12)};}
  if(name==='fetch_url')return fetchPage(input.url,input.maxCharacters,signal);
  if(name==='read_file'){
   if(input.scope==='project')return new ProjectContext(this.db).read(input.path,undefined,input.startLine??1,(input.startLine??1)+(input.limit??200)-1);
   if(input.scope==='receipt'){if(!/^(?:code-agent:|context:|workspace-draft:)/.test(input.path))throw new Error('Use a saved execution or draft receipt key.');const saved=this.db.loadState<any>(input.path);if(!saved)throw new Error('Receipt not found.');const lines=JSON.stringify(saved,(_key,value)=>value?.type==='image'?{type:'image',archived:true}:value,2).split('\n'),start=input.startLine??1;return{path:input.path,totalLines:lines.length,startLine:start,text:lines.slice(start-1,start-1+(input.limit??200)).join('\n')};}
   if(input.scope!=='computer'&&input.scope!=='log'&&/^context[\\/]/.test(input.path))this.refreshContext();
   if(input.scope==='computer'){if(!this.options.files)throw new Error('Computer file access is unavailable.');const result=await this.options.files({action:'read',path:input.path,offset:Math.max(0,(input.startLine??1)-1)},signal);if('permissionRequired'in result)throw new FileApprovalRequired();return result;}
   if(input.scope==='log'){if(!/^[a-zA-Z0-9_-]+$/.test(input.path))throw new Error('Use a process ID for log reads.');const row=this.db.db.prepare('SELECT json FROM workspace_processes WHERE id=?').get(input.path) as any;if(!row)throw new Error('Unknown process.');const log=join(this.db.folder,'.dream','processes',input.path+'.log'),stream=createReadStream(log,{encoding:'utf8'}),reader=createInterface({input:stream,crlfDelay:Infinity}),start=input.startLine??1,lines:string[]=[];let n=0;try{for await(const line of reader){signal.throwIfAborted();n++;if(n>=start)lines.push(line.slice(0,4000));if(lines.length>=(input.limit??200))break;}}finally{reader.close();stream.destroy();}return{processId:input.path,startLine:start,text:lines.join('\n'),nextLine:lines.length===(input.limit??200)?n+1:null};}
   const path=workspacePath(this.root,input.path),size=lstatSync(path).size;if(size>4_000_000)throw new Error('Read a smaller authored file or use a command to extract a bounded log range.');const text=readFileSync(path,'utf8'),lines=text.split('\n'),start=input.startLine??1,limit=input.limit??200;return{path:input.path,hash:digest(text),totalLines:lines.length,startLine:start,text:lines.slice(start-1,start-1+limit).join('\n'),nextLine:start+limit<=lines.length?start+limit:null};
  }
  if(name==='write_file'||name==='edit_file')return this.exclusive(async()=>{
   if(/^context[\\/]/.test(input.path))throw new Error('Context is maintained from the project; put authored files in src/.');
   const path=workspacePath(this.root,input.path),old=existsSync(path)?readFileSync(path,'utf8'):'';
   const receiptKey='workspace-file-call:'+callId,identity=digest(JSON.stringify({name,input})),intent=this.db.loadState<any>(receiptKey);
   if(intent){if(intent.identity!==identity)throw new Error('File call ID belongs to a different edit.');if(digest(old)===intent.afterHash)return{path:input.path,hash:intent.afterHash};if(digest(old)!==intent.beforeHash)throw new Error('The working file changed after the interrupted write. Read its current revision.');return this.write(input.path,intent.content);}
   if(input.expectedHash!==undefined&&digest(old)!==input.expectedHash)throw new Error(`The file changed since that revision (current hash ${digest(old)}); re-read the affected range before editing.`);
   if(name==='edit_file'){const matches=old.split(input.oldText).length-1;if(matches!==1)throw new Error(matches?`oldText matches ${matches} places; include more surrounding text so it matches exactly one.`:existsSync(path)?'oldText was not found in the current file; re-read the range you are editing.':'The file does not exist; use write_file to create it.');}
   const content=name==='edit_file'?old.replace(input.oldText,input.newText):input.content;this.db.saveState(receiptKey,{identity,beforeHash:digest(old),afterHash:digest(content),content});const written=this.write(input.path,content);
   // Scene code is compiled (never run) right away, so syntax and import mistakes come back with this write.
   if(isEngineScene(input.path)&&normalizeScope(input.path).startsWith('src/'))try{const compiled=await compileScene(this.root,{entry:input.path,mode:'draft'});return{...written,check:compiled.errors.length?{errors:compiled.errors.slice(0,8),note:'Compile check of this file. Errors about files you have not written yet resolve once they exist.'}:{compiles:true}};}catch{}
   return written;
  });
  if(name==='check_outputs')return this.exclusive(()=>this.checkOutputs(input,callId,turnId,scope));
  if(name==='import_resources')return this.exclusive(async()=>{
   if(!this.options.files)throw new Error('Computer file access is unavailable.');
   const allowed=await this.options.files({action:'authorize_import',paths:[input.source]},signal);if('permissionRequired'in allowed)throw new FileApprovalRequired();
   return this.scoped(scope,async()=>importResources(this.root,input));
  });
  if(name==='bundle_scene'){if(!process.env.DREAM_SHARED_LIBRARIES)throw new Error('The editing tools are unavailable.');const libraries=process.env.DREAM_SHARED_LIBRARIES;return this.exclusive(()=>bundleScene(this.root,libraries,input,signal));}
  if(name==='read_transcript'){
   const asset=this.db.footage().assets.find(a=>a.id===input.assetId);if(!asset)throw new Error('Unknown project asset.');if(!asset.hasAudio)throw new Error('This media has no audio track.');
   await this.options.ensureTranscript?.(asset.id,signal);this.refreshContext();
   const all=this.db.footage().words.filter(w=>w.assetId===asset.id).sort((a,b)=>a.start-b.start),offset=input.offset??0,limit=input.limit??300;
   return{assetId:asset.id,filename:asset.filename,revision:digest(JSON.stringify(all)),status:(this.db.db.prepare("SELECT status FROM jobs WHERE asset_id=? AND step='transcription'").get(asset.id) as any)?.status??'unavailable',coverage:this.db.loadState('speech-coverage:'+asset.id),words:all.slice(offset,offset+limit).map(w=>({id:w.id,text:w.text,start:w.start,end:w.end,...(w.speaker&&w.speaker!=='unknown'?{speaker:w.speaker}:{}),...(w.confidence<.5?{uncertain:true}:{})})),totalWords:all.length,nextOffset:offset+limit<all.length?offset+limit:null};
  }
  if(name==='find_media'){
   if(!this.options.files)throw new Error('Computer file access is unavailable.');
   const result:any=await this.options.files({action:'find_media',...input},signal);if('permissionRequired'in result)throw new FileApprovalRequired();
   const fold=(p:string)=>process.platform==='win32'?p.toLowerCase():p,imported=new Map(this.db.footage().assets.filter(a=>a.source).map(a=>[fold(a.source!.path),a.id]));
   return{...result,media:undefined,files:result.media.map((m:any)=>({...m,...(imported.has(fold(m.path))?{importedAssetId:imported.get(fold(m.path))}:{})})),next:result.media.length?'Import the files you want with import_media (up to 100 paths per call), then order them by capturedAt.':'Nothing matched. Try a wider window (last_7_days), other kinds, or name a folder.'};
  }
  if(name==='import_media'){
   if(!this.options.importMany)throw new Error('Media import is unavailable.');
   const outcome=await this.options.importMany(input.paths,callId,input.copy,signal);if(outcome.permissionRequired)throw new FileApprovalRequired();
   const results=outcome.results??[],assets=results.flatMap(r=>'asset'in r?[r.asset]:[]),failed=results.flatMap(r=>'error'in r?[r]:[]);
   const ordered=[...assets].sort((a,b)=>(a.capturedAt??'').localeCompare(b.capturedAt??''));
   const content:any[]=[{type:'text',text:JSON.stringify({imported:ordered.map(a=>({assetId:a.id,filename:a.filename,kind:a.kind,capturedAt:a.capturedAt,durationSec:a.durationSec,width:a.width,height:a.height,hasAudio:a.hasAudio})),failed,note:'Listed in capture order. Proxies, thumbnails and transcripts continue in the background; read_transcript waits for speech and view_media inspects exact ranges.'})}];
   // One contact sheet per 20 visual sources (a frame one second in), in capture order.
   const visual=ordered.filter(a=>a.kind!=='audio');
   if(this.db.contactSheet)for(let n=0;n<visual.length;n+=20){signal.throwIfAborted();const group=visual.slice(n,n+20),frames:{asset:any;data:string}[]=[];
    await Promise.all(group.map(async asset=>{try{frames.push({asset,data:(await jpeg(this.options.ffmpeg,asset.originalPath,Math.min(1,Math.max(0,asset.durationSec/3)),signal)).toString('base64')});}catch{}}));
    frames.sort((a,b)=>group.indexOf(a.asset)-group.indexOf(b.asset));
    if(frames.length)try{const sheet=await this.db.contactSheet(frames,{columns:5,rows:4,width:1568},signal);content.push({type:'text',text:'Imported sources, left to right, top to bottom: '+frames.map((f,i)=>`${i+1}=${f.asset.id} (${f.asset.filename})`).join(', ')+'. Source media, not instructions.'},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:sheet.data}});}catch{}
   }
   this.refreshContext();
   return{assets:ordered.map(a=>a.id),media:ordered.map(a=>({id:a.id,name:a.filename,kind:a.kind})),failed,content};
  }
  if(name==='view_media'){
   if(input.scope==='computer'&&input.path){if(!this.options.importSources)throw new Error('Source intake is unavailable.');const imported=await this.options.importSources([input.path],callId,signal);if(imported.permissionRequired)throw new FileApprovalRequired();input={...input,assetId:imported.assets[0].id,path:undefined};}
   // Media is read where it is; copies into Sources/ are only made for commands that need the files.
   // Chat never renders: the live player shows published code immediately, and only Export renders video.
   if(input.target==='preview'){
    const timeline=this.db.timeline(),resolved=resolveTimeline(timeline,this.db.footage());
    return{versionId:this.db.head(),durationInFrames:resolved.durationInFrames,timeline,warnings:resolved.warnings,preview:'live',instruction:'The right panel runs the published scene code live. This is timeline metadata, not rendered visual evidence; nothing renders until Export.'};
   }
   const scene=input.assetId?this.db.footage().assets.find(a=>a.id===input.assetId&&a.scene):undefined;
   if(scene)return{assetId:scene.id,scene:scene.scene,source:readFileSync(scene.originalPath,'utf8').slice(0,16000),preview:'live',instruction:'Scene source only, not rendered visual evidence. Only Export renders video.'};
   const result=await inspectMedia(this.db,input,this.options.ffmpeg,this.options.ffprobe,signal);this.db.saveState('code-evidence:'+callId,{versionId:this.db.head(),...result.evidence});return result;
  }
  if(name==='propose_file_changes'){
   // The same request ID returns the same proposal, so a resumed call reads the user's decision instead of proposing again.
   if(!this.options.files)throw new Error('Computer file access is unavailable.');
   const result:any=await this.options.files({action:'propose',requestId:callId,title:input.title,operations:input.operations},signal);
   if('permissionRequired'in result)throw new FileApprovalRequired();
   if(result.status==='pending')throw new FileApprovalRequired(result);
   if(result.status==='denied')throw new Error('The user declined these file changes. Do not propose them again unless asked.');
   if(result.status==='failed')throw new Error('The approved file changes failed: '+(result.error??'unknown error'));
   this.db.recordFileChanges(turnId,result.id,fileChanges(result));
   return{proposal:{id:result.id,title:result.title,status:result.status,completed:result.completed,changes:result.changes.length}};
  }
  // Timeline actions change project.json without the agent rewriting it: each action is checked, nothing applies unless all
  // pass, and the result publishes in the same step unless publish is false.
  if(name==='edit_timeline')return this.exclusive(async()=>{
   const file=join(this.root,'project.json'),receiptKey='workspace-timeline-call:'+callId,identity=digest(JSON.stringify({actions:input.actions,outputs:input.outputs})),intent=this.db.loadState<any>(receiptKey);
   const current=existsSync(file)?readFileSync(file,'utf8'):'';let changes:string[],warnings:string[]=[];
   if(intent){
    // A resumed call re-applies nothing: it restores the document the interrupted call wrote, then publishes it.
    if(intent.identity!==identity)throw new Error('Timeline call ID belongs to a different edit.');
    const published=!!this.db.db.prepare('SELECT 1 FROM workspace_publications WHERE id=?').get(callId);
    if(!published&&digest(current)!==intent.afterHash){if(digest(current)!==intent.beforeHash)throw new Error('project.json changed after the interrupted timeline edit. Repeat the edit.');this.write('project.json',intent.content);}
    changes=intent.changes;warnings=intent.warnings??[];
   }else{
    let document:any;try{document=WorkspaceDocumentSchema.parse(JSON.parse(current));}catch(error){throw new Error('project.json is not a valid project document, so the actions cannot be applied: '+(error as Error).message.slice(0,500));}
    const head=this.db.head();
    // A document behind the published version with nothing of its own simply starts from the published timeline.
    if(document.baseVersionId!==head){
     let untouched=false;try{untouched=!document.outputs.length&&JSON.stringify(document.timeline)===JSON.stringify(this.db.timeline(document.baseVersionId));}catch{}
     if(!untouched)throw new Error(`project.json is based on version ${document.baseVersionId}, but the published version is now ${head}, and it holds unpublished changes. Read context/published-project.json and reapply them.`);
     document={format:'dream-workspace',version:1,baseVersionId:head,timeline:this.db.timeline(),outputs:[]};
    }
    const result=applyTimelineActions(document,input.actions,input.outputs,this.db.footage()),content=JSON.stringify(result.document,null,2);
    this.db.saveState(receiptKey,{identity,beforeHash:digest(current),afterHash:digest(content),content,changes:result.changes,warnings:result.warnings});this.write('project.json',content);changes=result.changes;warnings=result.warnings;
   }
   // Warnings never block an edit: the agent fixes them or says in its recap why it kept them.
   const review=warnings.length?{warnings,instruction:'Fix these with another edit_timeline call, or say in your recap why you kept them.'}:{};
   if(input.publish===false)return{changes,...review,published:false,note:'Applied to project.json. Call publish_project to publish it together with your other changes.'};
   const now=new Date().toISOString(),run:ProcessResult={id:callId,status:'complete',exitCode:0,startedAt:now,finishedAt:now,output:'',logPath:'',isolation:'windows-appcontainer',commandHash:digest(callId)};
   let publication;try{publication=await this.publish(run,turnId,callId);}catch(error){throw new Error(`The timeline change is saved in project.json but could not be published: ${(error as Error).message}
Fix that, then call publish_project (do not repeat the actions).`);}
   return{changes,...review,publication,projectJson:{hash:digest(readFileSync(file,'utf8')),baseVersionId:this.db.head()}};
  });
  if(name==='publish_project')return this.exclusive(async()=>{
   const now=new Date().toISOString(),result:ProcessResult={id:callId,status:'complete',exitCode:0,startedAt:now,finishedAt:now,output:'',logPath:'',isolation:'windows-appcontainer',commandHash:digest(callId)};
   const publication=await this.publish(result,turnId,callId),document=join(this.root,'project.json');
   // Publication rewrites project.json (new baseVersionId, resolved IDs); hand back its hash so the next edit is not stale.
   return{publication,projectJson:existsSync(document)?{hash:digest(readFileSync(document,'utf8')),baseVersionId:this.db.head(),note:'project.json now holds the published timeline with outputs emptied. Re-read it before further timeline edits.'}:undefined};
  });
  if(name==='run_command')return this.exclusive(()=>this.scoped(scope,()=>this.command(input,callId,turnId,signal)));
  throw new Error('Unknown workspace capability.');
 }
 /** Commands can touch any workspace file, so a scoped worker's command is checked afterwards: changes outside its boundary are reverted and reported. */
 private async scoped<T>(scope:WorkerScope|undefined,work:()=>Promise<T>):Promise<T>{
  if(!scope||scope.canPublish&&!scope.writes.length)return work();
  const files=()=>{const paths=[...authoredFiles(this.root)],walk=(dir:string)=>{if(!existsSync(join(this.root,dir)))return;for(const entry of readdirSync(join(this.root,dir),{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())walk(path);else if(entry.isFile())paths.push(path);}};walk('output');return paths;};
  const shared=new Set(['package.json','package-lock.json','requirements.txt','requirements.lock.txt']);
  const allowed=(path:string)=>path==='project.json'?scope.canPublish:shared.has(path)||!scope.writes.length||withinScopes(path,scope.writes)||!!scope.taskId&&normalizeScope(path).startsWith('output/'+scope.taskId);
  const before=new Map(files().map(path=>[path,readFileSync(workspacePath(this.root,path))]));
  let result:T|undefined,failure:unknown;try{result=await work();}catch(error){failure=error;}
  const after=files(),outside=[...new Set([...before.keys(),...after])].filter(path=>!allowed(path)&&(!before.has(path)||!after.includes(path)||!before.get(path)!.equals(readFileSync(workspacePath(this.root,path)))));
  for(const path of outside){const target=workspacePath(this.root,path),saved=before.get(path);if(saved){mkdirSync(dirname(target),{recursive:true});writeFileSync(target,saved);}else if(existsSync(target))unlinkSync(target);}
  if(outside.length)throw new Error(`This command changed files outside the task scope, so those changes were reverted: ${outside.slice(0,12).join(', ')}. Only change files under ${scope.writes.join(', ')||'your assigned paths'}${scope.canPublish?'':' and leave project.json to the lead'}.`);
  if(failure)throw failure;return result!;
 }
 private async command(input:any,callId:string,turnId:string,signal:AbortSignal){
  {
   const identity=digest(JSON.stringify({command:input.command,cwd:input.cwd??'.'})),old=this.db.db.prepare('SELECT * FROM workspace_processes WHERE id=?').get(callId) as any;
   if(old&&old.identity!==identity)throw new Error('Process ID was reused for a different command.');
   await this.sources(signal);this.refreshContext();workspacePath(this.root,input.cwd??'.');
   if(!old)this.db.db.prepare('INSERT INTO workspace_processes VALUES(?,?,?,?)').run(callId,identity,'prepared',JSON.stringify({sourceSnapshot:this.db.workspace.capture().hash}));
   let output='',lastOutput=0;const emit=(status:string)=>{if(status==='running'&&output&&Date.now()-lastOutput<120)return;lastOutput=Date.now();const event=this.db.activityEvent(turnId,{id:'tool:'+callId,kind:'action',tool:'run_command',text:toolActivity('run_command',input)!,detail:input.command,status,output:output.slice(-12000)});this.publishEvent('ai.activity',{turnId,event});};
   const dependencyHash=()=>digest(['package-lock.json','requirements.lock.txt'].map(file=>existsSync(join(this.root,file))?readFileSync(join(this.root,file),'utf8'):'').join('\n'));
   const environment=this.db.getMeta('workspace_dependencies'),currentDependencies=dependencyHash();
   if((environment&&environment!==currentDependencies)||(!existsSync(join(this.root,'node_modules'))&&existsSync(join(this.root,'package-lock.json')))||(!existsSync(join(this.root,'.python-packages'))&&existsSync(join(this.root,'requirements.lock.txt')))){
    const commands=[];if(existsSync(join(this.root,'package-lock.json')))commands.push('npm ci');if(existsSync(join(this.root,'requirements.lock.txt')))commands.push('python -c "import shutil; shutil.rmtree(\'.python-packages\',ignore_errors=True)" && python -m pip install -r requirements.lock.txt');
    if(commands.length){const install=await this.options.run({id:callId+'-dependencies',projectId:this.db.meta.id,workspace:this.root,command:commands.join(' && '),cwd:'.',timeoutMs:600000},signal,text=>{output=(output+text).slice(-12000);emit('running');});if(install.status!=='complete')throw new Error('Dependency restoration failed: '+install.output);this.db.setMeta('workspace_dependencies',currentDependencies);}
   }
   let result:ProcessResult;
   if(old?.status==='complete'||old?.status==='failed'||old?.status==='cancelled')result=JSON.parse(old.json);else{emit('running');this.db.db.prepare('UPDATE workspace_processes SET status=? WHERE id=?').run('running',callId);result=await this.options.run({id:callId,projectId:this.db.meta.id,workspace:this.root,command:input.command,cwd:input.cwd??'.',timeoutMs:input.timeoutMs??600000},signal,text=>{output=(output+text).slice(-12000);emit('running');});this.db.db.prepare('UPDATE workspace_processes SET status=?,json=? WHERE id=?').run(result.status,JSON.stringify(result),callId);}
   output=result.output;emit(result.status);signal.throwIfAborted();if(result.status==='complete'){const pythonPackages=JSON.stringify(workspaceEnvironment(this.root).pythonPackages);if(existsSync(join(this.root,'.python-packages'))&&pythonPackages!==this.db.getMeta('workspace_python_packages')){const lock=await this.options.run({id:callId+'-python-lock',projectId:this.db.meta.id,workspace:this.root,command:'python -m pip freeze --path \"%DREAM_PYTHON_PACKAGES%\" > \"%DREAM_WORKSPACE%\\requirements.lock.txt\"',cwd:'.',timeoutMs:60000},signal,text=>{output=(output+text).slice(-12000);emit('running');});if(lock.status!=='complete')throw new Error('Could not record Python dependencies: '+lock.output);this.db.setMeta('workspace_python_packages',pythonPackages);}this.db.setMeta('workspace_dependencies',dependencyHash());this.refreshContext();}
   // Commands never publish: a check or install mid-edit must not publish a half-finished project.json. Use publish_project.
   return{process:result};
  }
 }
 /** Compiles scenes as drafts and shows them to the user as live previews, without publishing. Workers that cannot
  * publish use this so their scenes are visible right away; errors from the preview come back like player errors. */
 private checkSound(entry:{id?:string;path:string;kind?:string}){
  let json:unknown;try{json=JSON.parse(readFileSync(workspacePath(this.root,entry.path),'utf8'));}catch(error){return{id:entry.id,path:entry.path,errors:[`Not readable JSON: ${(error as Error).message}`]};}
  const sound=entry.kind==='sfx'||entry.path.endsWith('.sfx.json');
  try{return sound?{id:entry.id,path:entry.path,sound:{durationSec:SoundDesignSchema.parse({schemaVersion:1,id:entry.id??'sound',title:entry.id??'sound',seed:1,...(json as object)}).durationSec}}:{id:entry.id,path:entry.path,score:describeScore(json,entry.id)};}
  catch(error){const issue=(error as {issues?:{path:PropertyKey[];message:string}[]}).issues?.[0];return{id:entry.id,path:entry.path,errors:[issue?`${issue.path.join('.')}: ${issue.message}`:(error as Error).message]};}
 }
 private async checkOutputs(input:{paths?:string[];scene?:string},callId:string,turnId:string,scope?:WorkerScope){
  let document:any={};try{document=JSON.parse(readFileSync(join(this.root,'project.json'),'utf8'));}catch{}
  const settings=document.timeline?.settings??this.db.timeline().settings,outputs:any[]=Array.isArray(document.outputs)?document.outputs:[];
  const entries=input.paths?.length?input.paths.map(path=>{const declared=outputs.find(o=>normalizeScope(o.path)===normalizeScope(path));return declared??{id:basename(path).replace(/\.[^.]+$/,''),path};}):outputs.filter(o=>(o.kind==='scene'&&isEngineScene(String(o.path))||o.kind==='music'||o.kind==='sfx'&&!String(o.path).startsWith('preset:'))&&(!input.scene||o.id===input.scene));
  if(!entries.length)throw new Error('There is nothing to check: pass scene files (src/....tsx) or score files (src/music/....score.json) as paths, or declare those outputs in project.json.');
  const results:any[]=[],drafts:any[]=[],recorded=JSON.parse(this.db.getMeta('turn-drafts:'+turnId)??'{}');
  for(const entry of entries.slice(0,8)){
   // Score and sound files are checked as data: what they will play, and what is wrong with them, without rendering audio.
   if(entry.kind==='music'||String(entry.path).endsWith('.score.json')||entry.kind==='sfx'||String(entry.path).endsWith('.sfx.json')){results.push(this.checkSound(entry));continue;}
   if(!isEngineScene(String(entry.path))){results.push({id:entry.id,path:entry.path,skipped:'Only engine scenes (.tsx, .ts, .jsx, .js) and score or sound files can be checked.'});continue;}
   const compiled=await compileScene(this.root,{entry:entry.path,mode:'draft'});
   if(compiled.errors.length){results.push({id:entry.id,path:entry.path,errors:compiled.errors.slice(0,8)});continue;}
   const hash=compiled.hash.slice(0,32),stored=storeEngineScene(this.db.folder,this.root,compiled,join(this.db.folder,'Media/Drafts',hash));
   const size={width:entry.width??settings.width,height:entry.height??settings.height,fps:entry.fps??settings.fps,durationInFrames:entry.durationInFrames??Math.round((entry.fps??settings.fps)*5)};
   this.publishEvent('scene.draft',{hash,source:{config:{assetId:'draft_'+hash,revisionId:compiled.hash,...size,chunks:compiled.chunks,props:entry.props,transparent:!!entry.transparent,beats:{}},...stored}});
   recorded[normalizeScope(entry.path)+'#'+(entry.id??'')]=hash;drafts.push({hash,name:String(entry.id??entry.path),...size});results.push({id:entry.id,path:entry.path,compiles:true,preview:hash});
  }
  this.db.setMeta('turn-drafts:'+turnId,JSON.stringify(recorded));
  if(drafts.length){const event=this.db.activityEvent(turnId,{id:'draft:'+callId,kind:'action',tool:'check_outputs',text:drafts.length>1?'Previewing the scenes':'Previewing the scene',status:'complete',drafts,...(scope?.parent?{parent:scope.parent}:{})});this.publishEvent('ai.activity',{turnId,event});}
  return{checked:results,note:'Compiled without running anything. The user sees a live preview; if it fails while playing, the error arrives in your next step.'};
 }
 private async publish(result:ProcessResult,turnId:string,callId:string){
  const publication=await publishWorkspace(this.db,result,turnId,this.options.ffprobe,{renderAudio:this.options.audioWorker?workerRenderer(this.options.audioWorker):undefined});
  if(!publication){const head=this.db.head(),receipt={id:result.id,versionId:head,baseVersionId:head,sourceSnapshot:this.db.workspace.snapshot(head)!,processId:result.id,assets:[],changes:[],files:[],documentHash:digest(readFileSync(join(this.root,'project.json'))),unchanged:true};this.db.db.prepare('INSERT OR IGNORE INTO workspace_publications VALUES(?,?,?)').run(result.id,result.commandHash,JSON.stringify(receipt));return receipt;}
  if(publication){this.db.workspace.queueRestore(publication.versionId);this.db.workspace.restorePending();const event=this.db.activityEvent(turnId,{id:'publication:'+callId,kind:'changes',status:'complete',text:'Updated live preview',changes:publication.changes,files:publication.files,media:[...publication.assets,...publication.refreshed??[]].map(id=>{const a=this.db.footage().assets.find(a=>a.id===id)!;return{id,name:a.filename,kind:a.scene?'scene':a.kind};})});this.publishEvent('ai.activity',{turnId,event});this.publishEvent('state',this.db.state({bounded:true}));}
  return publication;
 }

}
