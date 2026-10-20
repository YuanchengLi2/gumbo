import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,dirname,relative,sep} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

/** Gumbo's cloud on this computer (the gateway's cloud.ts holds the list and signs the links): Save to cloud uploads a
 * project's edit and media, Open from cloud brings it to another computer. What is saved: Project.dreamproj, a
 * consistent copy of the project database (VACUUM INTO, so a project open in Gumbo can be saved), the workspace (without
 * installed packages and caches, which rebuild), Sources/ (copies of footage from elsewhere on the computer) and Media/.
 * Exports stay behind. Files are fingerprinted (SHA-256, remembered by size and modification time so an unchanged video
 * is not read again) and only changed ones go up; every download is checked against its fingerprint. */
export type CloudProgress={projectId:string;name:string;direction:'save'|'open';phase:'preparing'|'uploading'|'downloading'|'done';doneBytes:number;totalBytes:number};
export type CloudApi=(action:string,body:Record<string,unknown>)=>Promise<any>;
type Local={path:string;abs:string;size:number;mtimeMs:number};
const SKIP=new Set(['node_modules','.cache','.python-packages','.npm','.venv','.logs','__pycache__','.git']);

/** The project's files that a save carries, as cloud paths (forward slashes, relative to the project folder). */
export function projectFiles(folder:string):Local[]{
 const out:Local[]=[],add=(abs:string)=>{const s=statSync(abs);out.push({path:relative(folder,abs).split(sep).join('/'),abs,size:s.size,mtimeMs:s.mtimeMs});};
 const walk=(dir:string)=>{if(!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink()||SKIP.has(entry.name)||entry.name.endsWith('.partial'))continue;const abs=join(dir,entry.name);if(entry.isDirectory())walk(abs);else if(entry.isFile())add(abs);}};
 if(existsSync(join(folder,'Project.dreamproj')))add(join(folder,'Project.dreamproj'));
 for(const part of ['Workspace','Sources','Media'])walk(join(folder,part));
 return out;
}

async function fileHash(abs:string){const hash=createHash('sha256');await pipeline(createReadStream(abs),hash);return hash.digest('hex');}
/** Fingerprints, remembered across saves by path, size and modification time. */
export class HashCache{
 private entries:Record<string,{size:number;mtimeMs:number;sha256:string}>={};
 constructor(private file?:string){try{if(file&&existsSync(file))this.entries=JSON.parse(readFileSync(file,'utf8'));}catch{}}
 async of(f:Local){const known=this.entries[f.abs];if(known&&known.size===f.size&&known.mtimeMs===f.mtimeMs)return known.sha256;const sha256=await fileHash(f.abs);this.entries[f.abs]={size:f.size,mtimeMs:f.mtimeMs,sha256};return sha256;}
 save(){if(this.file)try{writeFileSync(this.file,JSON.stringify(this.entries));}catch{}}
}

/** A consistent copy of the project's database, taken while Gumbo may be using it. */
export function snapshotDatabase(folder:string){
 const dir=mkdtempSync(join(tmpdir(),'gumbo-cloud-')),target=join(dir,'project.sqlite');
 const db=new Database(join(folder,'.dream','project.sqlite'),{readonly:true,fileMustExist:true});
 try{db.prepare('VACUUM INTO ?').run(target);}finally{db.close();}
 return{path:target,dispose:()=>rmSync(dir,{recursive:true,force:true})};
}

async function each<T>(items:T[],limit:number,run:(item:T)=>Promise<void>){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length)await run(items[next++]);}));}

export async function saveToCloud(project:{id:string;name:string;folder:string},api:CloudApi,progress:(p:CloudProgress)=>void,options:{hashes?:HashCache;fetcher?:typeof fetch}={}){
 const fetcher=options.fetcher??fetch,hashes=options.hashes??new HashCache();
 const report=(phase:CloudProgress['phase'],doneBytes:number,totalBytes:number)=>progress({projectId:project.id,name:project.name,direction:'save',phase,doneBytes,totalBytes});
 const snapshot=snapshotDatabase(project.folder);
 try{
  const local=[{path:'.dream/project.sqlite',abs:snapshot.path,size:statSync(snapshot.path).size,mtimeMs:0},...projectFiles(project.folder)];
  const totalBytes=local.reduce((n,f)=>n+f.size,0);let hashed=0;report('preparing',0,totalBytes);
  const files:{path:string;size:number;sha256:string;abs:string}[]=[];
  for(const f of local){files.push({path:f.path,size:f.size,sha256:f.path==='.dream/project.sqlite'?await fileHash(f.abs):await hashes.of(f),abs:f.abs});hashed+=f.size;report('preparing',hashed,totalBytes);}
  hashes.save();
  const list=files.map(({path,size,sha256})=>({path,size,sha256})),body={projectId:project.id,name:project.name,device:hostname(),files:list};
  const plan=await api('cloud-upload',body);
  const uploads:{path:string;url:string}[]=plan.uploads??[],byPath=new Map(files.map(f=>[f.path,f]));
  const sending=uploads.reduce((n,u)=>n+(byPath.get(u.path)?.size??0),0);let sent=0;report('uploading',0,sending);
  await each(uploads,3,async u=>{const f=byPath.get(u.path)!;
   const response=await fetcher(u.url,{method:'PUT',body:Readable.toWeb(createReadStream(f.abs)) as any,headers:{'Content-Length':String(f.size)},duplex:'half'} as any);
   if(!response.ok)throw new Error(`Uploading ${f.path} failed (${response.status}).`);
   sent+=f.size;report('uploading',sent,sending);});
  const saved=await api('cloud-commit',body);report('done',sending,sending);
  return{...saved,uploaded:uploads.length,unchanged:plan.unchanged??0};
 }finally{snapshot.dispose();}
}

/** Brings a saved project to this computer: into folder (a new one, or the project's own when it is already here),
 * skipping files that already match, checking each download against its fingerprint. */
export async function openFromCloud(projectId:string,folder:string,api:CloudApi,progress:(p:CloudProgress)=>void,options:{fetcher?:typeof fetch;hashes?:HashCache}={}){
 const fetcher=options.fetcher??fetch,hashes=options.hashes??new HashCache();
 const found=await api('cloud-download',{projectId}),name=String(found.name??'Project'),files:{path:string;size:number;sha256:string;url:string}[]=found.files??[];
 const report=(phase:CloudProgress['phase'],doneBytes:number,totalBytes:number)=>progress({projectId,name,direction:'open',phase,doneBytes,totalBytes});
 const target=(path:string)=>{const abs=join(folder,...path.split('/'));if(relative(folder,abs).startsWith('..'))throw new Error('A cloud file points outside the project.');return abs;};
 const needed:typeof files=[];
 for(const f of files){const abs=target(f.path);if(existsSync(abs)){const s=statSync(abs);if(s.size===f.size&&await hashes.of({path:f.path,abs,size:s.size,mtimeMs:s.mtimeMs})===f.sha256)continue;}needed.push(f);}
 const totalBytes=needed.reduce((n,f)=>n+f.size,0);let done=0;report('downloading',0,totalBytes);
 await each(needed,3,async f=>{const abs=target(f.path),partial=abs+'.partial';mkdirSync(dirname(abs),{recursive:true});
  const response=await fetcher(f.url);if(!response.ok||!response.body)throw new Error(`Downloading ${f.path} failed (${response.status}).`);
  const hash=createHash('sha256');await pipeline(Readable.fromWeb(response.body as any),async function*(source){for await(const chunk of source){hash.update(chunk);yield chunk;}},createWriteStream(partial));
  if(hash.digest('hex')!==f.sha256){rmSync(partial,{force:true});throw new Error(`${f.path} arrived damaged; try again.`);}
  // A replaced database takes its old write-ahead log with it, so old and new pages never mix.
  if(f.path==='.dream/project.sqlite')for(const extra of ['-wal','-shm'])rmSync(abs+extra,{force:true});
  rmSync(abs,{force:true});renameSync(partial,abs);done+=f.size;report('downloading',done,totalBytes);});
 hashes.save();report('done',totalBytes,totalBytes);
 return{folder,name,downloaded:needed.length,unchanged:files.length-needed.length};
}
