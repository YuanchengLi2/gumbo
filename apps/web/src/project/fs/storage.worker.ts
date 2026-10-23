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
async function grantRoot(id:string):Promise<FileSystemDirectoryHandle>{const db=await grantDb();try{const handle=await new Promise<FileSystemDirectoryHandle|undefined>((resolve,reject)=>{const g=db.transaction('grants').objectStore('grants').get(id);g.onsuccess=()=>resolve(g.result);g.onerror=()=>reject(g.error);});if(!handle)throw enoent('/granted/'+id);return handle;}finally{db.close();}}
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

async function handle(request:FsOp):Promise<{json?:unknown;data?:Uint8Array}>{
 switch(request.op){
  case 'stat':{const found=await entry(request.path);if(found.kind==='directory')return{json:{kind:'directory',size:0,mtimeMs:0} satisfies FsStat};const file=await found.getFile();return{json:{kind:'file',size:file.size,mtimeMs:file.lastModified} satisfies FsStat};}
  case 'readdir':{const dir=await directory(request.path),list:{name:string;kind:string}[]=[];for await(const [name,h] of (dir as any).entries())list.push({name,kind:h.kind});return{json:list};}
  case 'mkdir':{
   if(!request.recursive){const [dir,name]=await parent(request.path);try{await dir.getDirectoryHandle(name);throw new Failure('EEXIST',`EEXIST: file already exists, mkdir '${request.path}'`,request.path);}catch(error){if(error instanceof Failure)throw error;}await dir.getDirectoryHandle(name,{create:true});return{};}
   const list=parts(request.path);let made:string|undefined;let dir=list[0]==='granted'?await grantRoot(list[1]):await navigator.storage.getDirectory();const start=list[0]==='granted'?2:0;
   for(let i=start;i<list.length;i++){try{dir=await dir.getDirectoryHandle(list[i]);}catch(error){if((error as DOMException).name==='TypeMismatchError')throw new Failure('EEXIST',`EEXIST: file already exists, mkdir '${request.path}'`,request.path);dir=await dir.getDirectoryHandle(list[i],{create:true});made??='/'+list.slice(0,i+1).join('/');}}
   return{json:made??null};
  }
  case 'read':{const file=await (await fileHandle(request.path)).getFile(),end=Math.min(file.size,request.offset+Math.min(request.length,CAPACITY-4096));return{json:{size:file.size},data:new Uint8Array(await file.slice(request.offset,end).arrayBuffer())};}
  case 'write':{
   if(request.mode==='wx'&&await exists(request.path))throw new Failure('EEXIST',`EEXIST: file already exists, open '${request.path}'`,request.path);
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
