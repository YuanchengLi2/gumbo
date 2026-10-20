import {WorkspaceStore} from './workspace-store';
import {timelineChanges,type ActivityStep,type TurnActivity} from './activity';
export type {ActivityStep,TurnActivity} from './activity';
import type {SourceInspector} from '@dream/footage';
import {isDeepStrictEqual} from 'node:util';
import {BlobStore} from './blob-store';
import {VersionStore} from './version-store';
import {ExecutionStore} from './execution-store';
import {requestIdentity} from './request-identity';
import {installVectorSearch,saveVectors,semanticSearch,fuseSearch,type SearchHit} from './vectors';
import {migrate,compactActivityEvent} from './migrate';
import Database from 'better-sqlite3';
import { randomUUID,createHash } from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {emptyTimeline,TimelineSchema,diff,timelineChangeList,type TimelineDocument,type Op} from '@dream/timeline';
import {emptyFootage,AssetSchema,type Asset,type FootageIndex} from '@dream/footage';
import {processBatch} from '@dream/guardrails';
import {persistAsset,hydrateAsset,hydratePath} from './paths';
export type ProjectMeta={id:string;name:string;folder:string;createdAt:string;updatedAt:string};
export type ContactSheetOptions={columns:number;rows:number;width:number};
export type ContactSheet={data:string;mimeType:'image/jpeg';columns:number;rows:number;count:number;width:number;height:number};
export type Version={id:string;parentId:string|null;summary:string;createdAt:string;turnId:string|null};
export type Message={id:string;role:'user'|'assistant';text:string;createdAt:string;turnId?:string;report?:unknown;assetIds?:string[];selection?:import('@dream/timeline').SelectionRef[];activity?:TurnActivity};
export type Job={id:string;assetId:string;step:string;status:string;percent:number;error:string|null};
export type ProjectExperience={firstDraftVersionId:string|null;turnId?:string;runStartedAt?:string;steps:ActivityStep[];activity?:TurnActivity;fileWait?:{kind:string;proposal?:any};bootstrap?:{status:string;error?:string}};
export type ProjectState={experience?:ProjectExperience;meta:ProjectMeta;timeline:TimelineDocument;versionId:string;footage:FootageIndex;messages:Message[];versions:Version[];jobs:Job[];canUndo:boolean;canRedo:boolean;aiStatus:string;outline:unknown;taskPlan?:unknown;workflow?:unknown;eventCursor:number;stateSequence?:number;history?:{messagesBefore:number|null;versionsBefore:number|null}};
const schema=`
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,parent_id TEXT,summary TEXT NOT NULL,created_at TEXT NOT NULL,turn_id TEXT,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS branches(id TEXT PRIMARY KEY,name TEXT NOT NULL,head_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,before_id TEXT NOT NULL,after_id TEXT NOT NULL,turn_id TEXT,undone INTEGER NOT NULL DEFAULT 0,seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(version_id TEXT NOT NULL,seq INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(version_id,seq));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,role TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL,turn_id TEXT,report TEXT);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,step TEXT NOT NULL,status TEXT NOT NULL,percent REAL NOT NULL DEFAULT 0,error TEXT,attempt INTEGER NOT NULL DEFAULT 0,UNIQUE(asset_id,step));
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS library(id TEXT PRIMARY KEY,kind TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,version_id TEXT NOT NULL,json TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS footage_fts USING fts5(id UNINDEXED,asset_id UNINDEXED,kind UNINDEXED,text);

`;
/** The reply a request gets when it stops because its project or the app closed before it finished. */
export const STOPPED_WHEN_CLOSED='This request stopped when the app closed, before it finished. Say "continue" to pick up where it left off.';
/** Values from another project's meta table, read-only (the user's other projects, for what they asked there): the file is
 * opened without a lock or migration and closed at once, so a project open in another window is not disturbed. */
export function peekMeta(folder:string,keys:string[]):Record<string,string|undefined>{
 let db:Database.Database|undefined;
 try{db=new Database(join(folder,'.dream','project.sqlite'),{readonly:true,fileMustExist:true});const get=db.prepare('SELECT value FROM meta WHERE key=?');return Object.fromEntries(keys.map(k=>[k,(get.get(k) as {value:string}|undefined)?.value]));}
 catch{return{};}finally{db?.close();}
}
export class ProjectDB {
 inspectSource?:SourceInspector;
 /** Tiles frames into one grid image (set by the project service, which has ffmpeg). */
 contactSheet?:(images:{data:string}[],options:ContactSheetOptions,signal?:AbortSignal)=>Promise<ContactSheet>;readonly db:Database.Database;readonly meta:ProjectMeta;readonly blobs:BlobStore;readonly executions:ExecutionStore;readonly workspace:WorkspaceStore;private versionsStore:VersionStore;private playbackCache?:{key:string;value:FootageIndex};
 constructor(public folder:string,name?:string){mkdirSync(join(folder,'.dream'),{recursive:true});for(const p of ['Media/Originals','Media/Proxies','Media/Analysis','Media/Generated','Exports','.dream/backups'])mkdirSync(join(folder,p),{recursive:true});this.db=new Database(join(folder,'.dream/project.sqlite'));this.db.pragma('journal_mode=WAL');this.db.pragma('foreign_keys=ON');try{migrate(this.db,schema);installVectorSearch(this.db);}catch(error){this.db.close();throw error;}
  this.blobs=new BlobStore(this.db);this.workspace=new WorkspaceStore(this);this.executions=new ExecutionStore(this.db,this.blobs);this.versionsStore=new VersionStore(this.db,this.blobs);this.versionsStore.migrateLegacy();this.migratePayloads();
  const found=this.getMeta('project');this.meta=found?{...JSON.parse(found),folder}:{id:`p_${randomUUID()}`,name:name??'Untitled project',folder,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  if(!found)this.db.transaction(()=>{this.setMeta('project',JSON.stringify(this.meta));const v=this.writeVersion(emptyTimeline(this.meta.id),null,'Project created',null);this.db.prepare('INSERT INTO branches VALUES(?,?,?)').run('main','Main',v);this.setMeta('branch','main');})();
  const manifestPath=join(folder,'Project.dreamproj');
  if(!existsSync(manifestPath)){const temporary=manifestPath+'.tmp';writeFileSync(temporary,JSON.stringify({format:'dream',schemaVersion:1,id:this.meta.id,database:'.dream/project.sqlite'},null,2));renameSync(temporary,manifestPath);}
  else{try{const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));if(manifest.format!=='dream'||manifest.schemaVersion!==1||manifest.id!==this.meta.id||manifest.database!=='.dream/project.sqlite')throw new Error('The project manifest does not match a supported Dream project database.');}catch(error){this.db.close();throw error;}}
  if(this.getMeta('first_draft_version')===undefined){const t=this.timeline();this.setMeta('first_draft_version',t.spine.length||t.attached.length||t.music.length?this.head():'');}
 }
 private migratePayloads(){
  if(this.getMeta('engine_payloads_v1')==='complete')return;
  const rows=this.db.prepare("SELECT key,value FROM meta WHERE value NOT LIKE '@dream:blob:%'").iterate() as Iterable<{key:string;value:string}>;
  for(const row of rows){if(!row.value.startsWith('{')&&!row.value.startsWith('['))continue;if(row.value.length<4096&&!/checkpoint|^inference:|^consult:|^creation:/.test(row.key))continue;const old=JSON.parse(row.value);this.db.transaction(()=>{this.saveState(row.key,old);if(!isDeepStrictEqual(this.loadState(row.key),old))throw new Error('Execution migration did not preserve its saved state.');})();}
  for(const table of ['requests','events'] as const){const column=table==='requests'?'result':'json';for(const row of this.db.prepare(`SELECT rowid AS row,${column} AS value FROM ${table} WHERE ${column} LIKE '%"timeline"%'`).iterate() as Iterable<{row:number;value:string}>){const old=JSON.parse(row.value);if(!old.timeline||!old.versionId)continue;if(!isDeepStrictEqual(this.timeline(old.versionId),old.timeline))throw new Error('Legacy timeline receipt differs from its saved version.');delete old.timeline;this.db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`).run(JSON.stringify(old),row.row);}}
  for(const row of this.db.prepare("SELECT id,json FROM library WHERE kind='visual_revision'").iterate() as Iterable<{id:string;json:string}>){const value=JSON.parse(row.json),definition=value.definition;if(definition?.schemaVersion===1&&definition.code){const code=definition.code,hash=this.blobs.put(code);if(this.blobs.get(hash)!==code)throw new Error('Source migration failed.');definition.schemaVersion=2;definition.source={entry:'scene.tsx',modules:{'scene.tsx':hash}};definition.code='';this.db.prepare('UPDATE library SET json=? WHERE id=?').run(JSON.stringify(value),row.id);}}
  this.setMeta('engine_payloads_v1','complete');
 }
 getMeta(key:string):string|undefined{const value=(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;return value?.startsWith('@dream:blob:')?JSON.stringify(this.executions.load(value.slice(12))):value;}
 loadState<T=any>(key:string):T|undefined{const value=(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;return value?value.startsWith('@dream:blob:')?this.executions.load(value.slice(12)):JSON.parse(value):undefined;}
 saveState(key:string,value:any){const scope=key+':'+(value.turnId??'')+':'+(value.journalEpoch??0);const hash=this.executions.save(scope,value);this.setMeta(key,'@dream:blob:'+hash);}
 setMeta(key:string,value:string){
  if((key==='ai_status'||key==='pending_request')&&!this.db.inTransaction){this.db.transaction(()=>this.setMeta(key,value))();return;}
  const previous=key==='pending_request'?this.getMeta(key):undefined;
  this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  if(key==='pending_request'&&value){const request=JSON.parse(value);if(!previous||JSON.parse(previous).turnId!==request.turnId){this.setMeta('turn_start_version',this.head());this.setMeta('turn_activity:'+request.turnId,JSON.stringify({steps:[],status:'queued',changes:[],startVersionId:this.head()}));this.setMeta('activity_steps','[]');this.setMeta('file_wait','');}}
  if(key==='ai_status'){const pending=this.getMeta('pending_request');if(pending){const turnId=JSON.parse(pending).turnId,activity=this.turnActivity(turnId);if(activity){activity.status=value;if(['complete','interrupted','awaiting_file_permission'].includes(value))this.updateActivityChanges(activity);this.saveActivity(turnId,activity);}}}
  if(key==='ai_status'&&value==='complete'&&!this.getMeta('first_draft_version')&&this.head()!==this.getMeta('turn_start_version')){const t=this.timeline();if(t.spine.length||t.attached.length||t.music.length)this.setMeta('first_draft_version',this.head());}
 }
 turnActivity(turnId?:string):TurnActivity|undefined{
  if(!turnId)return;const raw=this.getMeta('turn_activity:'+turnId);if(!raw)return;const activity=JSON.parse(raw) as TurnActivity;
  // The most recent 300 events are shown; older ones page in through activity_page.
  const rows=(this.db.prepare('SELECT json FROM activity_events WHERE turn_id=? ORDER BY sequence DESC LIMIT 300').all(turnId) as {json:string}[]).map(r=>JSON.parse(r.json)).reverse();
  if(rows.length||activity.events){const byId=new Map((activity.events??[]).map(e=>[e.id,e]));for(const row of rows)byId.set(row.id,row);activity.events=[...byId.values()].sort((a,b)=>a.sequence-b.sequence);}
  return activity;
 }
 /** Saves a turn's summary (status, phase, tasks, changes). Its events live in activity_events. */
 private saveActivity(turnId:string,activity:TurnActivity){const {events:_events,...rest}=activity;this.setMeta('turn_activity:'+turnId,JSON.stringify(rest));}
 activityPage(turnId:string,before?:number,limit=200){return(this.db.prepare('SELECT json FROM activity_events WHERE turn_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?').all(turnId,before??Number.MAX_SAFE_INTEGER,Math.min(500,limit)) as {json:string}[]).map(r=>JSON.parse(r.json)).reverse();}
 /** Records a scene error once per scene revision (or draft) and message; repeats only bump the count. */
 recordSceneError(error:{assetId?:string;revisionId?:string;draft?:string;turnId?:string;message:string;stack?:string;location?:string}){
  const id=createHash('sha256').update(JSON.stringify([error.revisionId??error.draft??error.assetId,error.message])).digest('hex').slice(0,32),now=new Date().toISOString();
  this.db.prepare('INSERT INTO scene_errors(id,asset_id,revision_id,draft,turn_id,message,stack,location,count,first_at,last_at) VALUES(?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET count=count+1,last_at=excluded.last_at,location=COALESCE(excluded.location,location),turn_id=COALESCE(excluded.turn_id,turn_id)').run(id,error.assetId??null,error.revisionId??null,error.draft??null,error.turnId??null,error.message.slice(0,2000),error.stack?.slice(0,8000)??null,error.location??null,now,now);
  return id;
 }
 /** Errors reported for the given scene revisions or drafts, newest first. */
 sceneErrors(filter:{revisions?:string[];drafts?:string[]}){
  const revisions=filter.revisions??[],drafts=filter.drafts??[];if(!revisions.length&&!drafts.length)return[];
  return this.db.prepare(`SELECT asset_id AS assetId,revision_id AS revisionId,draft,message,location,count FROM scene_errors WHERE revision_id IN (${revisions.map(()=>'?').join(',')||"''"}) OR draft IN (${drafts.map(()=>'?').join(',')||"''"}) ORDER BY last_at DESC LIMIT 20`).all(...revisions,...drafts) as {assetId?:string;revisionId?:string;draft?:string;message:string;location?:string;count:number}[];
 }
 /** Errors reported since a time that name a file and line (src/Paper.tsx:7:13), newest first. */
 recentSceneErrors(since:string){
  return this.db.prepare('SELECT asset_id AS assetId,revision_id AS revisionId,draft,message,location,count,last_at AS lastAt FROM scene_errors WHERE last_at>=? AND location IS NOT NULL ORDER BY last_at DESC LIMIT 20').all(since) as {assetId?:string;revisionId?:string;draft?:string;message:string;location:string;count:number;lastAt:string}[];
 }
 /** The text of one published file change, read from content-addressed blobs (publications store only hashes). */
 fileDiff(beforeHash?:string,afterHash?:string,maxChars=120000){const text=(hash?:string)=>hash?Buffer.from(this.blobs.get(hash),'base64').toString('utf8'):'';const before=text(beforeHash),after=text(afterHash);return{before:before.slice(0,maxChars),after:after.slice(0,maxChars),truncated:before.length>maxChars||after.length>maxChars};}
 recordUsage(event:{requestId:string;turnId?:string;model:string;purpose?:string;phase?:string;parent?:string;usage?:any;costUsd?:number;durationMs?:number;stopReason?:string}){const u=event.usage??{};this.db.prepare('INSERT OR IGNORE INTO ai_usage(request_id,turn_id,model,purpose,phase,parent,input_tokens,cache_read,cache_write,output_tokens,cost_usd,duration_ms,stop_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(event.requestId,event.turnId??null,event.model,event.purpose??null,event.phase??null,event.parent??null,u.input_tokens??0,u.cache_read_input_tokens??0,u.cache_creation_input_tokens??0,u.output_tokens??0,event.costUsd??0,event.durationMs??null,event.stopReason??null,new Date().toISOString());}
 /** What a request changed on the timeline, change by change, from the version before it to its last version, with the
  * operations that undo each change alone. Change cards in the chat show these. */
 turnChanges(turnId:string){
  const last=this.db.prepare('SELECT id FROM versions WHERE turn_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(turnId) as {id:string}|undefined;if(!last)return{changes:[]};
  const first=this.db.prepare('SELECT parent_id FROM versions WHERE turn_id=? ORDER BY created_at ASC,rowid ASC LIMIT 1').get(turnId) as {parent_id:string|null}|undefined,start=this.turnActivity(turnId)?.startVersionId??first?.parent_id;if(!start)return{changes:[]};
  const name=(id:string)=>{if(id.startsWith('output:'))return id.slice(7);const row=this.db.prepare('SELECT json FROM assets WHERE id=?').get(id) as {json:string}|undefined;return row?JSON.parse(row.json).filename:'media';};
  return{startVersionId:start,endVersionId:last.id,changes:timelineChangeList(this.timeline(start),this.timeline(last.id),{name,footage:this.footage()})};
 }
 /** Cost, tokens and time of a request, in total and per worker. */
 turnUsage(turnId:string){const rows=this.db.prepare('SELECT COALESCE(parent,\'main\') AS owner,model,COUNT(*) AS calls,SUM(cost_usd) AS cost,SUM(input_tokens+cache_read+cache_write) AS prompt,SUM(output_tokens) AS output,SUM(duration_ms) AS ms FROM ai_usage WHERE turn_id=? GROUP BY owner,model').all(turnId) as {owner:string;model:string;calls:number;cost:number;prompt:number;output:number;ms:number}[];return{rows,costUsd:rows.reduce((n,r)=>n+(r.cost??0),0),calls:rows.reduce((n,r)=>n+r.calls,0)};}
 private updateActivityChanges(activity:TurnActivity){const name=(id:string)=>{const row=this.db.prepare('SELECT json FROM assets WHERE id=?').get(id) as {json:string}|undefined;return row?JSON.parse(row.json).filename:'media';};let changes:string[]=[];if(activity.startVersionId)changes=timelineChanges(this.timeline(activity.startVersionId),this.timeline(),name);activity.changes=[...changes,...Object.values(activity.fileChanges??{}).flat()];}
 recordFileChanges(turnId:string,receiptId:string,changes:string[]){const activity=this.turnActivity(turnId);if(!activity||!changes.length)return;activity.fileChanges={...activity.fileChanges,[receiptId]:changes};this.updateActivityChanges(activity);this.saveActivity(turnId,activity);}
 activityStep(step:ActivityStep){const steps:ActivityStep[]=JSON.parse(this.getMeta('activity_steps')??'[]'),value={...step,updatedAt:new Date().toISOString()};const n=steps.findIndex(s=>(s.id??s.label)===(step.id??step.label));if(n<0)steps.push(value);else steps[n]=value;this.setMeta('activity_steps',JSON.stringify(steps));const pending=this.getMeta('pending_request');if(pending){const turnId=JSON.parse(pending).turnId,activity=this.turnActivity(turnId)??{steps:[],status:this.getMeta('ai_status')??'running',changes:[],startVersionId:this.getMeta('turn_start_version')??this.head()};activity.steps=steps;this.saveActivity(turnId,activity);this.activityEvent(turnId,{id:step.id??step.label,kind:'action',text:step.label,status:step.status});}}
 activityEvent(turnId:string,patch:Omit<import('@dream/contracts').PublicActivity,'sequence'>){
  if(!this.getMeta('turn_activity:'+turnId))return;
  const row=this.db.prepare('SELECT json FROM activity_events WHERE turn_id=? AND id=?').get(turnId,patch.id) as {json:string}|undefined,old=row?JSON.parse(row.json):this.turnActivity(turnId)?.events?.find(e=>e.id===patch.id),now=new Date().toISOString();
  const sequence=old?.sequence??(this.db.prepare('SELECT COALESCE(MAX(sequence)+1,0) AS next FROM activity_events WHERE turn_id=?').get(turnId) as {next:number}).next;
  const event=compactActivityEvent({...old,...patch,sequence,revision:(old?.revision??0)+1,startedAt:old?.startedAt??now,updatedAt:now});
  this.db.prepare('INSERT INTO activity_events(turn_id,id,sequence,json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(turn_id,id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at').run(turnId,patch.id,sequence,JSON.stringify(event),now);
  return event;
 }
 publicCommentary(turnId:string,requestId:string,text:string,status:string){this.activityEvent(turnId,{id:requestId,requestId,kind:'commentary',text,status});}
 setTasks(turnId:string,tasks:import('@dream/contracts').WorkTask[]){const activity=this.turnActivity(turnId);if(activity){activity.tasks=tasks;this.saveActivity(turnId,activity);}}
 setPhase(turnId:string,phase:'answering'|'planning'|'editing'){const activity=this.turnActivity(turnId);if(activity){activity.phase=phase;this.saveActivity(turnId,activity);}}
 experience():ProjectExperience{const pending=this.getMeta('pending_request'),wait=this.getMeta('file_wait'),bootstrap=this.getMeta('bootstrap');return{firstDraftVersionId:this.getMeta('first_draft_version')||null,turnId:pending?JSON.parse(pending).turnId:undefined,runStartedAt:this.getMeta('run_started_at')||undefined,steps:JSON.parse(this.getMeta('activity_steps')??'[]'),activity:this.turnActivity(pending?JSON.parse(pending).turnId:undefined),fileWait:wait?JSON.parse(wait):undefined,bootstrap:bootstrap?JSON.parse(bootstrap):undefined};}
 touch(){this.meta.updatedAt=new Date().toISOString();this.setMeta('project',JSON.stringify(this.meta));}
 head():string{return(this.db.prepare('SELECT head_id FROM branches WHERE id=?').get(this.getMeta('branch')??'main') as {head_id:string}).head_id;}
 timeline(id=this.head()):TimelineDocument {return this.versionsStore.read(id);}
 footage():FootageIndex {const index=emptyFootage();index.assets=(this.db.prepare('SELECT json FROM assets').all() as {json:string}[]).map(r=>hydrateAsset(AssetSchema.parse(JSON.parse(r.json)),this.folder));for(const kind of ['words','shots','faces'] as const)index[kind]=(this.db.prepare('SELECT json FROM index_records WHERE kind=? ORDER BY rowid').all(kind) as {json:string}[]).map(r=>JSON.parse(r.json));index.shots=index.shots.map(shot=>({...shot,framePaths:shot.framePaths.map(path=>hydratePath(path,this.folder))}));index.revision=Number(this.getMeta('index_revision')??0);return index;}
 playbackFootage(t=this.timeline()):FootageIndex {
  const key=this.head()+':'+this.getMeta('index_revision');if(this.playbackCache?.key===key)return this.playbackCache.value;const index=emptyFootage();index.revision=Number(this.getMeta('index_revision')??0);index.assets=(this.db.prepare('SELECT json FROM assets').all() as {json:string}[]).map(row=>hydrateAsset(AssetSchema.parse(JSON.parse(row.json)),this.folder));
  // The words of everything that can be captioned: main-track clips and the music track, where separately recorded
  // narration sits (without them a vlog's narration played with no captions in the player, the agent's view and Export).
  const ranges=new Map<string,{start:number;end:number}[]>();for(const clip of [...t.spine,...t.music]){const list=ranges.get(clip.assetId)??[];list.push({start:clip.srcIn-.001,end:clip.srcOut+.001});ranges.set(clip.assetId,list);}
  const words=new Map<string,FootageIndex['words'][number]>(),query=this.db.prepare("SELECT json FROM index_records WHERE kind='words' AND json_extract(json,'$.assetId')=? AND json_extract(json,'$.start')>=? AND json_extract(json,'$.start')<? ORDER BY json_extract(json,'$.start')");
  for(const [assetId,runs] of ranges){const merged:{start:number;end:number}[]=[];for(const run of runs.sort((a,b)=>a.start-b.start)){const last=merged.at(-1);if(last&&run.start<=last.end)last.end=Math.max(last.end,run.end);else merged.push({...run});}for(const run of merged)for(const row of query.all(assetId,run.start,run.end) as {json:string}[]){const word=JSON.parse(row.json);words.set(word.id,word);}}
  index.words=[...words.values()];for(const id of new Set(t.spine.flatMap(c=>c.framing?.faceTrackId?[c.framing.faceTrackId]:[]))){const row=this.db.prepare("SELECT json FROM index_records WHERE kind='faces' AND id=?").get(id) as {json:string}|undefined;if(row)index.faces.push(JSON.parse(row.json));}this.playbackCache={key,value:index};return index;
 }
 /** Footage imported from elsewhere on the computer whose original has moved or is gone (or a project folder copied to
  * another computer): each source whose file is missing points at the project's own copy in Sources/<asset id>/. */
 relinkFromSources(){let relinked=0;for(const asset of this.footage().assets){if(!asset.originalPath||existsSync(asset.originalPath))continue;const copy=join(this.folder,'Sources',asset.id,basename(asset.originalPath.replace(/\\/g,'/')));if(existsSync(copy)){this.saveAsset({...asset,originalPath:copy});relinked++;}}if(relinked)this.event('assets.relinked',{count:relinked});return relinked;}
 saveAsset(asset:Asset){this.db.prepare('INSERT INTO assets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(asset.id,JSON.stringify(persistAsset(AssetSchema.parse(asset),this.folder)));this.setMeta('index_revision',String(Number(this.getMeta('index_revision')??0)+1));}
 saveRecords(kind:'words'|'shots'|'faces'|'observations',records:({id:string}&Record<string,unknown>)[]){this.db.transaction(()=>{for(const r of records){const json=JSON.stringify(r),previous=this.db.prepare('SELECT json FROM index_records WHERE kind=? AND id=?').get(kind,r.id) as {json:string}|undefined;if(previous?.json===json)continue;this.db.prepare('INSERT INTO index_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,r.id,json);const row=r as Record<string,unknown>;if(previous)this.db.prepare('DELETE FROM footage_fts WHERE id=? AND kind=?').run(r.id,kind);this.db.prepare('INSERT INTO footage_fts(id,asset_id,kind,text) VALUES(?,?,?,?)').run(r.id,String(row.assetId??''),kind,kind==='words'?String(row.text??''):JSON.stringify(row.log??''));}this.setMeta('index_revision',String(Number(this.getMeta('index_revision')??0)+1));})();}
 replaceRecords(kind:'words'|'shots'|'faces'|'observations',assetId:string,records:({id:string}&Record<string,unknown>)[]){if(records.some(r=>r.assetId!==assetId))throw new Error('Analysis results belong to another asset.');this.db.transaction(()=>{this.db.prepare('DELETE FROM footage_fts WHERE kind=? AND asset_id=?').run(kind,assetId);this.db.prepare("DELETE FROM index_records WHERE kind=? AND json_extract(json,'$.assetId')=?").run(kind,assetId);this.saveRecords(kind,records);})();}
 writeVersion(t:TimelineDocument,parent:string|null,summary:string,turnId:string|null):string {const id=`v_${randomUUID()}`;this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)').run(id,parent,summary,new Date().toISOString(),turnId,'');this.versionsStore.write(id,t,parent);if(parent)this.workspace.inherit(id,parent);this.touch();return id;}
 apply(ops:Op[],label:string,requestId:string,expected:string,turnId?:string,options?:{snapToSpeech?:boolean}){return this.db.transaction(()=>{
  const identity=requestIdentity(ops,label,expected,turnId,options);
  const duplicate=this.db.prepare('SELECT result,identity FROM requests WHERE id=?').get(requestId) as {result:string;identity:string|null}|undefined;
  if(duplicate){const result=JSON.parse(duplicate.result);let original=duplicate.identity;
   if(!original){const version=this.db.prepare('SELECT parent_id,summary,turn_id FROM versions WHERE id=?').get(result.versionId) as {parent_id:string;summary:string;turn_id:string|null}|undefined;if(!version)throw new Error('The saved edit receipt is missing its version.');const storedOps=(this.db.prepare('SELECT json FROM operations WHERE version_id=? ORDER BY seq').all(result.versionId) as {json:string}[]).map(row=>JSON.parse(row.json));original=requestIdentity(storedOps,version.summary,version.parent_id,version.turn_id);this.db.prepare('UPDATE requests SET identity=? WHERE id=?').run(original,requestId);}
   if(original!==identity)throw new Error('This request ID belongs to a different edit. Use a new request ID for changed instructions.');return {...result,timeline:result.timeline??this.timeline(result.versionId)};
  }
  const before=this.head();if(expected!==before)throw new Error('The edit changed. Reload the current version before applying this request.');const old=this.timeline();const result=processBatch(old,ops,this.footage(),undefined,options);const version=this.writeVersion(result.timeline,before,label,turnId??null);const branch=this.getMeta('branch')??'main';this.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(version,branch);this.db.prepare('DELETE FROM actions WHERE branch_id=? AND undone=1').run(branch);
  const last=this.db.prepare('SELECT * FROM actions WHERE branch_id=? ORDER BY seq DESC LIMIT 1').get(branch) as {id:string;turn_id:string|null;seq:number}|undefined;if(turnId&&last?.turn_id===turnId)this.db.prepare('UPDATE actions SET after_id=? WHERE id=?').run(version,last.id);else this.db.prepare('INSERT INTO actions(id,branch_id,before_id,after_id,turn_id,seq) VALUES(?,?,?,?,?,?)').run(randomUUID(),branch,before,version,turnId??null,(last?.seq??0)+1);
  ops.forEach((o,n)=>this.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(version,n,JSON.stringify(o)));const out={versionId:version,timeline:result.timeline,warnings:result.warnings,diff:diff(old,result.timeline)};this.db.prepare('INSERT INTO requests(id,result,identity) VALUES(?,?,?)').run(requestId,JSON.stringify({versionId:version,warnings:out.warnings,diff:out.diff}),identity);if(this.getMeta('ai_status')!=='running'&&!this.getMeta('first_draft_version')&&(result.timeline.spine.length||result.timeline.attached.length||result.timeline.music.length))this.setMeta('first_draft_version',version);this.event('ops.applied',{versionId:version,warnings:out.warnings,diff:out.diff});return out;
 })();}
 undo(redo=false){return this.db.transaction(()=>{const branch=this.getMeta('branch')??'main';const a=this.db.prepare(`SELECT * FROM actions WHERE branch_id=? AND undone=? ORDER BY seq ${redo?'ASC':'DESC'} LIMIT 1`).get(branch,redo?1:0) as {id:string;before_id:string;after_id:string}|undefined;if(!a)return this.state();const target=redo?a.after_id:a.before_id;const v=this.writeVersion(this.timeline(target),this.head(),redo?'Redo':'Undo',null);this.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(v,branch);this.db.prepare('UPDATE actions SET undone=? WHERE id=?').run(redo?0:1,a.id);this.workspace.inherit(v,target);this.workspace.queueRestore(v);this.event('version.restored',{versionId:v});return this.state();})();}
 restore(id:string){const t=this.timeline(id);return this.db.transaction(()=>{const branch=this.getMeta('branch')??'main',before=this.head(),after=this.writeVersion(t,before,'Restored version',null);this.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(after,branch);this.db.prepare('DELETE FROM actions WHERE branch_id=? AND undone=1').run(branch);const seq=(this.db.prepare('SELECT MAX(seq) AS seq FROM actions WHERE branch_id=?').get(branch) as {seq:number|null}).seq??0;this.db.prepare('INSERT INTO actions(id,branch_id,before_id,after_id,seq) VALUES(?,?,?,?,?)').run(randomUUID(),branch,before,after,seq+1);this.workspace.inherit(after,id);this.workspace.queueRestore(after);this.event('version.restored',{versionId:after});return this.state();})();}
 branch(id:string,name:string){this.timeline(id);const branch=`b_${randomUUID()}`;this.db.prepare('INSERT INTO branches VALUES(?,?,?)').run(branch,name,id);this.setMeta('branch',branch);this.workspace.queueRestore(id);return this.state();}
 userMessage(text:string,turnId:string,assetIds:string[]=[],selection:import('@dream/timeline').SelectionRef[]=[]){const existing=this.db.prepare("SELECT id FROM messages WHERE role='user' AND turn_id=? ORDER BY rowid LIMIT 1").get(turnId) as {id:string}|undefined;if(existing){this.db.prepare('UPDATE messages SET attachments=?,selection=? WHERE id=?').run(JSON.stringify(assetIds),JSON.stringify(selection),existing.id);return;}const m=this.message('user',text,turnId,undefined,assetIds);if(selection.length)this.db.prepare('UPDATE messages SET selection=? WHERE id=?').run(JSON.stringify(selection),m.id);}
 /** A request still marked running when the project opens was cut off: the app quit, crashed or was stopped before the request
  * could record its end. It is marked stopped, gets a reply saying so unless it already has one, and its unfinished steps
  * are closed, so the chat never shows a request that silently went quiet. */
 recoverStoppedRun(){
  if(this.getMeta('ai_status')!=='running')return false;
  this.setMeta('ai_status','interrupted');
  const turnId=this.loadState<{turnId?:string}>('pending_request')?.turnId;if(!turnId)return true;
  const last=this.db.prepare('SELECT role,turn_id FROM messages ORDER BY created_at DESC,rowid DESC LIMIT 1').get() as {role:string;turn_id:string|null}|undefined;
  if(!(last?.role==='assistant'&&last.turn_id===turnId))this.message('assistant',STOPPED_WHEN_CLOSED,turnId);
  for(const row of this.db.prepare('SELECT json FROM activity_events WHERE turn_id=?').all(turnId) as {json:string}[]){const event=JSON.parse(row.json);if(['running','ready','paused'].includes(event.status))this.activityEvent(turnId,{id:event.id,kind:event.kind,text:event.text,status:'interrupted'});}
  return true;
 }
 message(role:Message['role'],text:string,turnId?:string,report?:unknown,assetIds:string[]=[]):Message {const m={id:randomUUID(),role,text,createdAt:new Date().toISOString(),turnId,report,assetIds};this.db.prepare('INSERT INTO messages(id,role,text,created_at,turn_id,report,attachments) VALUES(?,?,?,?,?,?,?)').run(m.id,role,text,m.createdAt,turnId??null,report?JSON.stringify(report):null,JSON.stringify(assetIds));this.event('message.created',m);return m;}
 event(type:string,payload:unknown){this.db.prepare('INSERT INTO events(type,json,created_at) VALUES(?,?,?)').run(type,JSON.stringify(payload),new Date().toISOString());}
 events(after=0){return(this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq').all(after) as {seq:number;type:string;json:string}[]).map(e=>({seq:e.seq,type:e.type,payload:JSON.parse(e.json)}));}
 job(assetId:string,step:string,status:string,percent=0,error?:string){this.db.prepare('INSERT INTO jobs(id,asset_id,step,status,percent,error) VALUES(?,?,?,?,?,?) ON CONFLICT(asset_id,step) DO UPDATE SET status=excluded.status,percent=excluded.percent,error=excluded.error').run(`${assetId}:${step}`,assetId,step,status,percent,error??null);this.event('ingest.progress',{assetId,step,status,percent,error});}
 state(options:{bounded?:boolean}={}):ProjectState {const branch=this.getMeta('branch')??'main',pending=this.getMeta('pending_request'),workflow=pending?this.getMeta('workflow:'+JSON.parse(pending).turnId):undefined;return {experience:this.experience(),workflow:workflow?JSON.parse(workflow):null,taskPlan:this.getMeta('task_plan')?JSON.parse(this.getMeta('task_plan')!):null,aiStatus:this.getMeta('ai_status')??'idle',outline:this.getMeta('outline')?JSON.parse(this.getMeta('outline')!):null,eventCursor:(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as {seq:number}).seq,meta:{...this.meta},timeline:this.timeline(),versionId:this.head(),footage:options.bounded?this.playbackFootage():this.footage(),history:options.bounded?{messagesBefore:this.pageBoundary('messages'),versionsBefore:this.pageBoundary('versions')}:undefined,messages:(this.db.prepare(options.bounded?'SELECT * FROM (SELECT rowid AS cursor,* FROM messages ORDER BY rowid DESC LIMIT 50) ORDER BY cursor':'SELECT * FROM messages ORDER BY rowid').all() as Record<string,unknown>[]).map(m=>({id:String(m.id),role:m.role as Message['role'],text:String(m.text),createdAt:String(m.created_at),turnId:m.turn_id?String(m.turn_id):undefined,report:m.report?JSON.parse(String(m.report)):undefined,assetIds:m.attachments?JSON.parse(String(m.attachments)):[],selection:m.selection?JSON.parse(String(m.selection)):[],activity:this.turnActivity(m.turn_id?String(m.turn_id):undefined)})),versions:(this.db.prepare('SELECT id,parent_id,summary,created_at,turn_id FROM versions ORDER BY rowid DESC'+(options.bounded?' LIMIT 50':'')).all() as Record<string,unknown>[]).map(v=>({id:String(v.id),parentId:v.parent_id?String(v.parent_id):null,summary:String(v.summary),createdAt:String(v.created_at),turnId:v.turn_id?String(v.turn_id):null})),jobs:(this.db.prepare(options.bounded?"SELECT * FROM jobs WHERE status NOT IN ('complete','completed','retired') OR (status<>'retired' AND rowid IN (SELECT rowid FROM jobs ORDER BY rowid DESC LIMIT 50))":'SELECT * FROM jobs').all() as Record<string,unknown>[]).map(j=>({id:String(j.id),assetId:String(j.asset_id),step:String(j.step),status:String(j.status),percent:Number(j.percent),error:j.error?String(j.error):null})),canUndo:!!this.db.prepare('SELECT id FROM actions WHERE branch_id=? AND undone=0 LIMIT 1').get(branch),canRedo:!!this.db.prepare('SELECT id FROM actions WHERE branch_id=? AND undone=1 LIMIT 1').get(branch)};}
 pageBoundary(table:'messages'|'versions'){const row=this.db.prepare(`SELECT rowid AS cursor FROM ${table} ORDER BY rowid DESC LIMIT 1 OFFSET 49`).get() as {cursor:number}|undefined;return row&&this.db.prepare(`SELECT 1 FROM ${table} WHERE rowid<? LIMIT 1`).get(row.cursor)?row.cursor:null;}
 historyPage(kind:'messages'|'versions',before?:number,limit=50){const size=Math.min(100,Math.max(1,limit));const rows=this.db.prepare(`SELECT rowid AS cursor,* FROM ${kind} WHERE rowid<? ORDER BY rowid DESC LIMIT ?`).all(before??Number.MAX_SAFE_INTEGER,size+1) as any[];const page=rows.slice(0,size);return{items:page.map(r=>kind==='messages'?{id:r.id,role:r.role,text:r.text,createdAt:r.created_at,turnId:r.turn_id??undefined,report:r.report?JSON.parse(r.report):undefined,assetIds:r.attachments?JSON.parse(r.attachments):[],activity:this.turnActivity(r.turn_id??undefined)}:{id:r.id,parentId:r.parent_id,summary:r.summary,createdAt:r.created_at,turnId:r.turn_id}),nextBefore:rows.length>size?page.at(-1).cursor:null};}
 libraryPage(kind:'audio'|'visual',before?:number,limit=20,query=''){const rows=this.db.prepare("SELECT rowid AS cursor,id,kind,json FROM library WHERE kind=? AND rowid<? AND (?='' OR instr(lower(COALESCE(json_extract(json,'$.definition.title'),json_extract(json,'$.title'),'')),lower(?))>0) ORDER BY rowid DESC LIMIT ?").all(kind==='visual'?'visual_revision':'generated_revision',before??Number.MAX_SAFE_INTEGER,query,query,Math.min(50,Math.max(1,limit))+1) as any[];const page=rows.slice(0,limit);return{items:page.map(row=>{const v=JSON.parse(row.json);return{revisionId:v.revisionId,assetId:v.assetId,title:v.definition?.title??v.title,kind:v.kind??'visual',durationInFrames:v.definition?.durationInFrames,fps:v.definition?.fps};}),nextBefore:rows.length>limit?page.at(-1).cursor:null};}
 rename(name:string){this.meta.name=name;this.meta.updatedAt=new Date().toISOString();this.setMeta('project',JSON.stringify(this.meta));return this.state();}
 async backup(destination:string){mkdirSync(dirname(destination),{recursive:true});await this.db.backup(destination);}
 saveEmbeddings(modelId:string,rows:{id:string;assetId:string;vector:number[]}[]){saveVectors(this.db,modelId,rows);}
 search(query:string,embedding?:{modelId:string;vector:number[]}){const lexical=query.trim()?this.db.prepare('SELECT id,asset_id,kind,text,bm25(footage_fts) AS score FROM footage_fts WHERE footage_fts MATCH ? ORDER BY score LIMIT 20').all(query.split(/\s+/).filter(Boolean).map(s=>'"'+s.replaceAll('"','""')+'"').join(' OR ')) as SearchHit[]:[];return embedding?fuseSearch(lexical,semanticSearch(this.db,embedding.modelId,embedding.vector)):lexical;}

 close(){if(!this.db.open)return;this.db.pragma('wal_checkpoint(TRUNCATE)');this.db.close();}
}
