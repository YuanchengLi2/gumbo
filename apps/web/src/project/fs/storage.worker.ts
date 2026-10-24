/// <reference lib="webworker" />
import {HEADER,CAPACITY,type FsOp,type FsStat,type FsError} from './protocol';

/** The storage worker: owns this browser's private file storage (OPFS) and answers the project worker's synchronous
 * file calls (protocol.ts). Paths are POSIX, from the OPFS root: /projects/<id>/…, /imports/…, /tmp/…. /granted/<id>/…
 * reaches a folder the user granted on their computer (a File System Access handle kept in IndexedDB). */
let ctl:Int32Array,bytes:Uint8Array;
const encoder=new TextEncoder();
class Failure extends Error{constructor(public code:string,message:string,public path?:string){super(message);}}
const enoent=(path:string)=>new Failure('ENOENT',`ENOENT: no such file or directory, '${path}'`,path);

const parts=(path:string)=>path.split('/').filter(p=>p&&p!=='.');
function grantDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('gumbo-grants',1);r.onupgradeneeded=()=>r.result.createObjectStore('grants');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function grantRoot(id:string):Promise<FileSystemDirectoryHandle>{const db=await grantDb();try{const handle=await new Promise<FileSystemDirectoryHandle|undefined>((resolve,reject)=>{const g=db.transaction('grants').objectStore('grants').get(id);g.onsuccess=()=>resolve(g.result);g.onerror=()=>reject(g.error);});if(!handle)throw enoent('/granted/'+id);
 // A kept folder needs allowing again on each visit (the page asks on the next message, browse or export): until then
 // it is refused as such, never shown as empty or missing.
 if(await (handle as any).queryPermission({mode:'readwrite'})!=='granted')throw new Failure('EACCES',`EACCES: permission denied, '/granted/${id}': the browser needs Gumbo allowed into this folder again. It asks the next time you send a message or export.`,'/granted/'+id);
 return handle;}finally{db.close();}}
/** The directory holding a path's last part, and that part's name. */
async function parent(path:string,create=false):Promise<[FileSystemDirectoryHandle,string]>{
 const list=parts(path);if(!list.length)throw new Failure('EISDIR','EISDIR: the root is a directory',path);
 let dir:FileSystemDirectoryHandle,start=0;
 if(list[0]==='granted'){if(list.length<2)throw new Failure('EISDIR','EISDIR: illegal operation on a directory',path);dir=await grantRoot(list[1]);start=2;if(list.length===2)throw new Failure('EISDIR','EISDIR: illegal operation on a directory',path);}
 else dir=await navigator.storage.getDirectory();
 for(const part of list.slice(start,-1)){try{dir=await dir.getDirectoryHandle(part,{create});}catch(error){throw (error as DOMException).name==='TypeMismatchError'?new Failure('ENOTDIR',`ENOTDIR: not a directory, '${path}'`,path):enoent(path);}}
 return [dir,list.at(-1)!];
}
async function directory(path:string,create=false):Promise<FileSystemDirectoryHandle>{
 const list=parts(path);if(!list.length)return navigator.storage.getDirectory();
 if(list[0]==='granted'&&list.length===2)return grantRoot(list[1]);
 const [dir,name]=await parent(path,create);
 try{return await dir.getDirectoryHandle(name,{create});}catch(error){throw (error as DOMException).name==='TypeMismatchError'?new Failure('ENOTDIR',`ENOTDIR: not a directory, '${path}'`,path):enoent(path);}
}
async function entry(path:string):Promise<FileSystemFileHandle|FileSystemDirectoryHandle>{
 if(!parts(path).length||(parts(path)[0]==='granted'&&parts(path).length<=2))return directory(path);
 const [dir,name]=await parent(path);
 try{return await dir.getFileHandle(name);}catch(error){if((error as DOMException).name!=='TypeMismatchError')throw enoent(path);}
 return dir.getDirectoryHandle(name);
}
async function fileHandle(path:string,create=false){const [dir,name]=await parent(path,false);try{return await dir.getFileHandle(name,{create});}catch(error){throw (error as DOMException).name==='TypeMismatchError'?new Failure('EISDIR',`EISDIR: illegal operation on a directory, '${path}'`,path):enoent(path);}}
async function exists(path:string){try{await entry(path);return true;}catch{return false;}}
async function copyFile(from:string,to:string){const source=await (await fileHandle(from)).getFile(),target=await fileHandle(to,true),writer=await target.createWritable();await source.stream().pipeTo(writer);}
async function copyTree(from:string,to:string){const source=await directory(from);await directory(to,true);for await(const [name,handle] of (source as any).entries())handle.kind==='file'?await copyFile(`${from}/${name}`,`${to}/${name}`):await copyTree(`${from}/${name}`,`${to}/${name}`);}

/** Open descriptors. A file opened for writing in this site's storage holds a sync access handle, which reads and writes
 * at any position without copying the file (a writable stream copies it on every write); descriptors on one path share
 * it, and the path's other calls go through it while it is held. A granted folder's file has no such handle: it is
 * written through a writable stream at the position, which is slower. */
type Held={access:FileSystemSyncAccessHandle;users:number;modified:number};
const descriptors=new Map<number,{path:string;write:boolean;append:boolean}>(),held=new Map<string,Held>();let nextFd=1;
const ebusy=(path:string)=>new Failure('EBUSY',`EBUSY: resource busy or locked, open '${path}'`,path);
async function hold(path:string,create:boolean):Promise<Held|undefined>{
 if(parts(path)[0]==='granted')return undefined;
 const found=held.get(path);if(found){found.users++;return found;}
 const file=await fileHandle(path,create);let access:FileSystemSyncAccessHandle;
 try{access=await (file as any).createSyncAccessHandle();}catch(error){if((error as DOMException).name==='NoModificationAllowedError')throw ebusy(path);throw error;}
 const entry={access,users:1,modified:Date.now()};held.set(path,entry);return entry;
}
function release(path:string){const found=held.get(path);if(found&&--found.users<=0){found.access.flush();found.access.close();held.delete(path);}}
async function open(path:string,flags:string){
 const write=/[wa+]/.test(flags),create=/[wa]/.test(flags);
 if(flags.includes('x')&&await exists(path))throw new Failure('EEXIST',`EEXIST: file already exists, open '${path}'`,path);
 if(!create&&!await exists(path))throw enoent(path);
 const holding=write?await hold(path,create):undefined;
 if(write&&!holding&&create&&!await exists(path)){const writer=await (await fileHandle(path,true)).createWritable();await writer.close();}
 if(flags.startsWith('w')){if(holding){holding.access.truncate(0);holding.modified=Date.now();}else if(write){const writer=await (await fileHandle(path,true)).createWritable();await writer.close();}}
 const fd=nextFd++;descriptors.set(fd,{path,write,append:flags.startsWith('a')});return fd;
}
const described=(fd:number)=>{const found=descriptors.get(fd);if(!found)throw new Failure('EBADF','EBADF: bad file descriptor');return found;};
async function sizeOf(path:string){const holding=held.get(path);return holding?holding.access.getSize():(await (await fileHandle(path)).getFile()).size;}
async function readAt(path:string,position:number,length:number){
 const holding=held.get(path),count=Math.max(0,Math.min(length,CAPACITY-4096));
 if(holding){const buffer=new Uint8Array(count);const read=holding.access.read(buffer,{at:position});return buffer.subarray(0,read);}
 const file=await (await fileHandle(path)).getFile();return new Uint8Array(await file.slice(position,Math.min(file.size,position+count)).arrayBuffer());
}
async function writeAt(path:string,position:number|null,data:Uint8Array){
 const holding=held.get(path);
 if(holding){const at=position??holding.access.getSize();holding.access.write(data as Uint8Array<ArrayBuffer>,{at});holding.modified=Date.now();return;}
 // In this site's storage, a sync access handle held just for this write: a writable stream that keeps the data would
 // copy the whole file first, every time (a copy written a megabyte at a time took minutes).
 const brief=await hold(path,true);if(brief)try{brief.access.write(data as Uint8Array<ArrayBuffer>,{at:position??brief.access.getSize()});return;}finally{release(path);}
 const target=await fileHandle(path,true),writer=await target.createWritable({keepExistingData:true});
 await writer.seek(position??(await target.getFile()).size);await writer.write(data as Uint8Array<ArrayBuffer>);await writer.close();
}

async function handle(request:FsOp):Promise<{json?:unknown;data?:Uint8Array}>{
 switch(request.op){
  case 'stat':{const holding=held.get(request.path);if(holding)return{json:{kind:'file',size:holding.access.getSize(),mtimeMs:holding.modified} satisfies FsStat};
   const found=await entry(request.path);if(found.kind==='directory')return{json:{kind:'directory',size:0,mtimeMs:0} satisfies FsStat};const file=await found.getFile();return{json:{kind:'file',size:file.size,mtimeMs:file.lastModified} satisfies FsStat};}
  case 'open':return{json:{fd:await open(request.path,request.flags)}};
  case 'pread':{const {path}=described(request.fd);return{json:{size:await sizeOf(path)},data:await readAt(path,request.position,request.length)};}
  case 'pwrite':{const d=described(request.fd);if(!d.write)throw new Failure('EBADF','EBADF: bad file descriptor, write');await writeAt(d.path,d.append?null:request.position,request.data);return{};}
  case 'ftruncate':{const d=described(request.fd),holding=held.get(d.path);if(holding){holding.access.truncate(request.length);holding.modified=Date.now();}else{const brief=await hold(d.path,false);if(brief)try{brief.access.truncate(request.length);}finally{release(d.path);}else{const writer=await (await fileHandle(d.path)).createWritable({keepExistingData:true});await writer.truncate(request.length);await writer.close();}}return{};}
  case 'close':{const d=descriptors.get(request.fd);if(d){descriptors.delete(request.fd);if(d.write)release(d.path);}return{};}
  case 'readdir':{const dir=await directory(request.path),list:{name:string;kind:string}[]=[];for await(const [name,h] of (dir as any).entries())list.push({name,kind:h.kind});return{json:list};}
  case 'mkdir':{
   if(!request.recursive){const [dir,name]=await parent(request.path);try{await dir.getDirectoryHandle(name);throw new Failure('EEXIST',`EEXIST: file already exists, mkdir '${request.path}'`,request.path);}catch(error){if(error instanceof Failure)throw error;}await dir.getDirectoryHandle(name,{create:true});return{};}
   const list=parts(request.path);let made:string|undefined;let dir=list[0]==='granted'?await grantRoot(list[1]):await navigator.storage.getDirectory();const start=list[0]==='granted'?2:0;
   for(let i=start;i<list.length;i++){try{dir=await dir.getDirectoryHandle(list[i]);}catch(error){if((error as DOMException).name==='TypeMismatchError')throw new Failure('EEXIST',`EEXIST: file already exists, mkdir '${request.path}'`,request.path);dir=await dir.getDirectoryHandle(list[i],{create:true});made??='/'+list.slice(0,i+1).join('/');}}
   return{json:made??null};
  }
  case 'read':{if(held.has(request.path))return{json:{size:await sizeOf(request.path)},data:await readAt(request.path,request.offset,request.length)};
   const file=await (await fileHandle(request.path)).getFile(),end=Math.min(file.size,request.offset+Math.min(request.length,CAPACITY-4096));return{json:{size:file.size},data:new Uint8Array(await file.slice(request.offset,end).arrayBuffer())};}
  case 'write':{
   if(request.mode==='wx'&&await exists(request.path))throw new Failure('EEXIST',`EEXIST: file already exists, open '${request.path}'`,request.path);
   const holding=held.get(request.path);if(holding){if(request.mode==='w')holding.access.truncate(0);await writeAt(request.path,null,request.data);return{};}
   // Appending in this site's storage writes in place (writeAt); a writable stream would copy the file first.
   if(request.mode==='a'&&parts(request.path)[0]!=='granted'){await writeAt(request.path,null,request.data);return{};}
   const target=await fileHandle(request.path,true),writer=await target.createWritable({keepExistingData:request.mode==='a'});
   if(request.mode==='a'){const size=(await target.getFile()).size;await writer.seek(size);}
   await writer.write(request.data as Uint8Array<ArrayBuffer>);await writer.close();return{};
  }
  case 'unlink':{const [dir,name]=await parent(request.path);try{await dir.getFileHandle(name);}catch(error){throw (error as DOMException).name==='TypeMismatchError'?new Failure('EPERM',`EPERM: operation not permitted, unlink '${request.path}'`,request.path):enoent(request.path);}await dir.removeEntry(name);return{};}
  case 'rm':{let dir:FileSystemDirectoryHandle,name:string;try{[dir,name]=await parent(request.path);await entry(request.path);}catch(error){if(request.force)return{};throw error;}
   try{await dir.removeEntry(name,{recursive:request.recursive});}catch(error){if((error as DOMException).name==='InvalidModificationError')throw new Failure('ENOTEMPTY',`ENOTEMPTY: directory not empty, rmdir '${request.path}'`,request.path);if(!request.force)throw error;}return{};}
  case 'rename':{
   const source=await entry(request.from);if(await exists(request.to)){const target=await entry(request.to);if(target.kind==='file'&&source.kind==='file'){const [dir,name]=await parent(request.to);await dir.removeEntry(name);}else if(target.kind!==source.kind)throw new Failure(target.kind==='directory'?'EISDIR':'ENOTDIR','rename across kinds',request.to);}
   const [toDir,toName]=await parent(request.to,false);
   try{if(typeof (source as any).move==='function'){await (source as any).move(toDir,toName);return{};}}catch{}
   source.kind==='file'?await copyFile(request.from,request.to):await copyTree(request.from,request.to);const [fromDir,fromName]=await parent(request.from);await fromDir.removeEntry(fromName,{recursive:true});return{};
  }
  case 'copy':{if(request.exclusive&&await exists(request.to))throw new Failure('EEXIST',`EEXIST: file already exists, copyfile '${request.to}'`,request.to);await copyFile(request.from,request.to);return{};}
 }
}
function answer(status:0|1,json:unknown,data?:Uint8Array){
 const text=json===undefined?new Uint8Array():encoder.encode(JSON.stringify(json));
 if(HEADER+text.length+(data?.length??0)>bytes.length){status=1;json={code:'E2BIG',message:'The answer does not fit the file channel.'};return answer(1,json);}
 bytes.set(text,HEADER);if(data)bytes.set(data,HEADER+text.length);
 Atomics.store(ctl,1,status);Atomics.store(ctl,2,text.length);Atomics.store(ctl,3,data?.length??0);Atomics.store(ctl,0,1);Atomics.notify(ctl,0);
}
self.onmessage=async(event:MessageEvent)=>{
 if(event.data?.init){const shared=event.data.init as SharedArrayBuffer;ctl=new Int32Array(shared,0,4);bytes=new Uint8Array(shared);(self as unknown as Worker).postMessage({ready:true});return;}
 try{const result=await handle(event.data as FsOp);answer(0,result.json,result.data);}
 catch(error){const failure:FsError=error instanceof Failure?{code:error.code,message:error.message,path:error.path}:{code:'EIO',message:(error as Error)?.message??String(error)};answer(1,failure);}
};
