/** Files by their POSIX path in this browser's storage, for the workers that read and write media asynchronously: OPFS
 * from its root, and /granted/<id>/… inside a folder the user granted (its File System Access handle, kept in IndexedDB
 * by the page). The storage worker answers the same paths synchronously (fs/storage.worker.ts). */
const parts=(path:string)=>path.split('/').filter(p=>p&&p!=='.');
const grants=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('gumbo-grants',1);r.onupgradeneeded=()=>r.result.createObjectStore('grants');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
/** Keeps a folder the user chose so it can be read and written by path, as /granted/<its name>-<4 characters>. */
export async function grantFolder(handle:FileSystemDirectoryHandle){
 const id=`${handle.name.replace(/[^\w .-]/g,'_').slice(0,40)||'folder'}-${crypto.randomUUID().slice(0,4)}`,db=await grants();
 try{await new Promise<void>((resolve,reject)=>{const t=db.transaction('grants','readwrite');t.objectStore('grants').put(handle,id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}finally{db.close();}
 return `/granted/${id}`;
}
/** Asks again for kept folders this visit has not been allowed into (each visit starts without permission; Chrome can
 * offer "Allow on every visit"), for the folders among paths. The page calls it during the click or key press that
 * needs them, since the browser asks only then. A folder the user turns down stays refused (EACCES in the storage worker). */
export async function reallow(paths:string[]){
 for(const id of new Set(paths.filter(p=>p.startsWith('/granted/')).map(p=>p.split('/')[2]))){
  try{const handle=await grant(id) as any;if(await handle.queryPermission({mode:'readwrite'})==='prompt')await handle.requestPermission({mode:'readwrite'});}catch{}
 }
}
async function grant(id:string):Promise<FileSystemDirectoryHandle>{
 const db=await grants();
 try{const handle=await new Promise<FileSystemDirectoryHandle|undefined>((resolve,reject)=>{const g=db.transaction('grants').objectStore('grants').get(id);g.onsuccess=()=>resolve(g.result);g.onerror=()=>reject(g.error);});if(!handle)throw new Error(`No access to ${id}: grant the folder again.`);return handle;}finally{db.close();}
}
async function walk(list:string[],create:boolean){
 let dir=list[0]==='granted'?await grant(list[1]):await navigator.storage.getDirectory();
 for(const part of list.slice(list[0]==='granted'?2:0))dir=await dir.getDirectoryHandle(part,{create});
 return dir;
}
export async function fileHandle(path:string,create=false){const list=parts(path);if(!list.length)throw new Error('A file path is needed.');const dir=await walk(list.slice(0,-1),create);try{return await dir.getFileHandle(list.at(-1)!,{create});}catch{throw Object.assign(new Error(`No such file: ${path}`),{code:'ENOENT'});}}
export const fileAt=async(path:string)=>(await fileHandle(path)).getFile();
/** A writable stream for a new file at path (its folder is made), which mediabunny's StreamTarget writes into by position. */
export async function writable(path:string){return (await fileHandle(path,true)).createWritable({keepExistingData:false});}
export async function writeFile(path:string,data:Blob|Uint8Array<ArrayBuffer>){const out=await writable(path);await out.write(data);await out.close();}
export async function exists(path:string){try{await fileHandle(path);return true;}catch{return false;}}
/** Removes a file, or a folder with what is in it; a path that is not there is left alone. */
export async function remove(path:string){
 const list=parts(path);if(!list.length)return;
 try{await (await walk(list.slice(0,-1),false)).removeEntry(list.at(-1)!,{recursive:true});}
 catch(error){if(!['NotFoundError','TypeMismatchError'].includes((error as DOMException).name))throw error;}
}
