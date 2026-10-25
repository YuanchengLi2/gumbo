import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,dirname} from 'node:path';
import type {ProjectDB} from './index';

/** Writes a file through a temporary copy and a rename. Windows refuses the rename (EPERM, EACCES, EBUSY) while
 * OneDrive, a virus scanner or a reader briefly holds the old file open, so it retries for about a second and then
 * writes the file in place. */
export function replaceFileSync(target:string,data:string|Uint8Array,suffix='.dream-write'){
 const temp=target+suffix;writeFileSync(temp,data);
 for(let attempt=0;;attempt++){
  try{renameSync(temp,target);return;}
  catch(error:any){if(!['EPERM','EACCES','EBUSY'].includes(error?.code))throw error;
   if(attempt<8){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(attempt+1));continue;}
   writeFileSync(target,data);try{unlinkSync(temp);}catch{}return;}
 }
}
// footage/, guides/ and HISTORY.md are written from the project for the agent to read, and GUMBO.md is the project's memory, which an
// undo or a restored version leaves as it is: none of them belong to a version's files.
export const sourceExcluded=new Set(['node_modules','.venv','.python-packages','.npm','__pycache__','.git','.cache','.logs','output','context','footage','guides','GUMBO.md','HISTORY.md']);
export function workspacePath(root:string,path:string){
 if(path.includes('\0')||(!isAbsolute(path)&&path.includes(':'))||(isAbsolute(path)&&path.slice(2).includes(':')))throw new Error('Use a path inside the workspace.');
 const target=resolve(root,path),rel=relative(root,target);
 if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw new Error('Path is outside the workspace. For a file elsewhere on the computer use scope computer (read, list, grep), or bring media in with the media tool first.');
 let current=root;if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Workspace links are not allowed.');
 for(const part of rel.split(/[\\/]/).filter(Boolean)){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Workspace links are not allowed.');}
 return target;
}
export function authoredFiles(root:string){
 const paths:string[]=[];
 const walk=(dir:string)=>{if(!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){if(sourceExcluded.has(entry.name)||entry.isSymbolicLink())continue;const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())paths.push(relative(root,path).replaceAll('\\','/'));}};
 walk(root);return paths.sort();
}
export const digest=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
/** Source content lives in the database, outside the process write boundary. */
export class WorkspaceStore {
 constructor(private db:ProjectDB){}
 capture(root=join(this.db.folder,'Workspace')){
  const files:Record<string,string>={};let bytes=0;
  for(const path of authoredFiles(root)){const abs=workspacePath(root,path),size=lstatSync(abs).size;bytes+=size;if(size>32*1024*1024||bytes>128*1024*1024)throw new Error('Authored source exceeds 128 MB. Put generated media in output/.');files[path]=this.db.blobs.put(readFileSync(abs).toString('base64'));}
  const hash=this.db.blobs.put(JSON.stringify(files));return{hash,files};
 }
 associate(versionId:string,hash:string){this.db.db.prepare('INSERT OR REPLACE INTO workspace_versions(version_id,snapshot_hash) VALUES(?,?)').run(versionId,hash);}
 snapshot(versionId:string):string|undefined{return(this.db.db.prepare('SELECT snapshot_hash FROM workspace_versions WHERE version_id=?').get(versionId) as any)?.snapshot_hash;}
 inherit(versionId:string,from:string){const hash=this.snapshot(from);if(hash)this.associate(versionId,hash);}
 files(hash:string):Record<string,string>{return JSON.parse(this.db.blobs.get(hash));}
 /** Rebase an unchanged document after a direct timeline edit. Preserve drafts. */
 syncPublishedDocument(){
  const path=join(this.db.folder,'Workspace','project.json');if(!existsSync(path))return;
  let doc:any;try{doc=JSON.parse(readFileSync(path,'utf8'));}catch{return;}
  const head=this.db.head();if(doc.baseVersionId===head||doc.outputs?.length)return;
  const base=this.snapshot(doc.baseVersionId),current=this.snapshot(head);if(!base||!current)return;
  const oldFile=this.files(base)['project.json'];if(!oldFile)return;
  const baseline=JSON.parse(Buffer.from(this.db.blobs.get(oldFile),'base64').toString('utf8'));
  if(JSON.stringify(doc.timeline)!==JSON.stringify(baseline.timeline))return;
  const canonical=JSON.stringify({...doc,baseVersionId:head,timeline:this.db.timeline(),outputs:[]},null,2),files=this.files(current);
  files['project.json']=this.db.blobs.put(Buffer.from(canonical).toString('base64'));
  replaceFileSync(path,canonical,'.dream-sync');this.associate(head,this.db.blobs.put(JSON.stringify(files)));
 }
 /** Persist restoration intent with the timeline transaction; replay it before any next execution. */
 queueRestore(versionId:string){const hash=this.snapshot(versionId);if(hash)this.db.setMeta('workspace_restore',JSON.stringify({versionId,hash}));}
 restorePending(){
  const pending=this.db.loadState<{versionId:string;hash:string}>('workspace_restore');if(!pending)return;
  const root=join(this.db.folder,'Workspace');mkdirSync(root,{recursive:true});
  if(!this.db.getMeta('workspace_restore_draft')){const draft=this.capture(root).hash;this.db.setMeta('workspace_restore_draft',draft);this.db.setMeta('workspace-draft:'+Date.now(),JSON.stringify({hash:draft,fromVersion:this.db.head()}));}
  const files=this.files(pending.hash);
  for(const path of authoredFiles(root))if(!(path in files))unlinkSync(workspacePath(root,path));
  for(const [path,hash] of Object.entries(files)){const target=workspacePath(root,path);mkdirSync(dirname(target),{recursive:true});replaceFileSync(target,Buffer.from(this.db.blobs.get(hash),'base64'),'.dream-restore');}
  const projectPath=join(root,'project.json');if(existsSync(projectPath)){const doc=JSON.parse(readFileSync(projectPath,'utf8'));doc.baseVersionId=pending.versionId;doc.timeline=this.db.timeline(pending.versionId);doc.outputs=[];writeFileSync(projectPath,JSON.stringify(doc,null,2));}
  const restored=this.capture(root);this.db.db.transaction(()=>{this.associate(pending.versionId,restored.hash);this.db.setMeta('workspace_restore','null');this.db.setMeta('workspace_restore_draft','');})();
 }
}
