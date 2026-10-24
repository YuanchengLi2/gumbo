import {Buffer} from 'buffer';
import {normalize,resolve as resolvePath,dirname} from 'path-browserify';
import {HEADER,CAPACITY,type FsOp,type FsStat,type FsError} from './protocol';

/** node:fs for the project service in the browser: the same synchronous calls, answered by the storage worker over a
 * shared buffer (protocol.ts). connectFs must finish before any call. Only what the project service uses is here; the
 * rest throws plainly. */
let ctl:Int32Array,bytes:Uint8Array,storage:Worker;
const decoder=new TextDecoder();
export async function connectFs(worker:Worker){
 const shared=new SharedArrayBuffer(HEADER+CAPACITY);ctl=new Int32Array(shared,0,4);bytes=new Uint8Array(shared);storage=worker;
 await new Promise<void>(ready=>{const listen=(event:MessageEvent)=>{if(event.data?.ready){worker.removeEventListener('message',listen);ready();}};worker.addEventListener('message',listen);worker.postMessage({init:shared});});
}
function fail(error:FsError,syscall?:string):never{const e=new Error(error.message) as NodeJS.ErrnoException;e.code=error.code;e.path=error.path;e.syscall=syscall;e.errno=-1;throw e;}
function call(request:FsOp):{json:any;data?:Uint8Array}{
 if(!ctl)throw new Error('The file system is not connected yet.');
 Atomics.store(ctl,0,0);storage.postMessage(request);
 if(Atomics.wait(ctl,0,0,120_000)==='timed-out')fail({code:'ETIMEDOUT',message:`File storage did not answer: ${request.op}`});
 const status=ctl[1],jsonLength=ctl[2],dataLength=ctl[3];
 const json=jsonLength?JSON.parse(decoder.decode(bytes.slice(HEADER,HEADER+jsonLength))):undefined;
 const data=dataLength?bytes.slice(HEADER+jsonLength,HEADER+jsonLength+dataLength):undefined;
 if(status)fail(json as FsError,request.op);
 return{json,data};
}
const toPath=(path:unknown)=>{if(path instanceof URL)path=path.pathname;if(typeof path!=='string')throw new TypeError('A path must be a string.');return normalize(resolvePath('/',path));};
const toBytes=(data:unknown,encoding?:string):Uint8Array=>typeof data==='string'?Buffer.from(data,(encoding??'utf8') as BufferEncoding):data instanceof Uint8Array?data:ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):Buffer.from(String(data));
const encodingOf=(options:unknown)=>typeof options==='string'?options:(options as {encoding?:string}|undefined)?.encoding??undefined;

export class Stats{
 constructor(private s:FsStat){}
 get size(){return this.s.size;}get mtimeMs(){return this.s.mtimeMs;}get mtime(){return new Date(this.s.mtimeMs);}get ctime(){return this.mtime;}get birthtime(){return this.mtime;}get atime(){return this.mtime;}get ctimeMs(){return this.s.mtimeMs;}get birthtimeMs(){return this.s.mtimeMs;}get mode(){return this.s.kind==='file'?0o100644:0o40755;}
 isFile(){return this.s.kind==='file';}isDirectory(){return this.s.kind==='directory';}isSymbolicLink(){return false;}
}
export class Dirent{constructor(public name:string,private kind:string,public parentPath:string){}get path(){return this.parentPath;}isFile(){return this.kind==='file';}isDirectory(){return this.kind==='directory';}isSymbolicLink(){return false;}}

export function statSync(path:unknown,options?:{throwIfNoEntry?:boolean}):Stats|undefined{try{return new Stats(call({op:'stat',path:toPath(path)}).json);}catch(error){if(options?.throwIfNoEntry===false&&(error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
export const lstatSync=statSync;
export function existsSync(path:unknown){try{call({op:'stat',path:toPath(path),exists:true});return true;}catch{return false;}}
export function accessSync(path:unknown){call({op:'stat',path:toPath(path)});}
export function readdirSync(path:unknown,options?:{withFileTypes?:boolean}|string):any[]{const at=toPath(path),list=call({op:'readdir',path:at}).json as {name:string;kind:string}[];list.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);return typeof options==='object'&&options?.withFileTypes?list.map(e=>new Dirent(e.name,e.kind,at)):list.map(e=>e.name);}
export function mkdirSync(path:unknown,options?:{recursive?:boolean}|number){return call({op:'mkdir',path:toPath(path),recursive:typeof options==='object'&&!!options?.recursive}).json??undefined;}
export function mkdtempSync(prefix:string){for(;;){const path=prefix+Math.random().toString(36).slice(2,8);try{mkdirSync(path);return path;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')mkdirSync(dirname(path),{recursive:true});else if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}}
function readRange(path:string,offset:number,length:number){return call({op:'read',path,offset,length});}
export function readFileSync(path:unknown,options?:unknown):any{
 if(typeof path==='number'){const fd=descriptor(path);return readFileSync(fd.path,options);}
 const at=toPath(path),chunks:Uint8Array[]=[];let offset=0,size=Infinity;
 while(offset<size){const {json,data}=readRange(at,offset,CAPACITY);size=json.size;if(!data?.length)break;chunks.push(data);offset+=data.length;}
 const buffer=Buffer.concat(chunks.map(c=>Buffer.from(c.buffer,c.byteOffset,c.byteLength)));const encoding=encodingOf(options);return encoding?buffer.toString(encoding as BufferEncoding):buffer;
}
function writeAll(path:string,data:Uint8Array,first:'w'|'a'|'wx'){
 const step=CAPACITY-4096;if(data.length<=step){call({op:'write',path,mode:first,data});return;}
 for(let offset=0;offset<data.length;offset+=step)call({op:'write',path,mode:offset===0?first:'a',data:data.slice(offset,offset+step)});
}
export function writeFileSync(path:unknown,data:unknown,options?:unknown){
 if(typeof path==='number'){writeSync(path,toBytes(data,encodingOf(options)));return;}
 const flag=typeof options==='object'&&options?(options as {flag?:string}).flag:undefined;writeAll(toPath(path),toBytes(data,encodingOf(options)),flag==='wx'?'wx':flag==='a'?'a':'w');
}
export function appendFileSync(path:unknown,data:unknown,options?:unknown){writeAll(toPath(path),toBytes(data,encodingOf(options)),'a');}
export function unlinkSync(path:unknown){call({op:'unlink',path:toPath(path)});}
export function rmSync(path:unknown,options?:{recursive?:boolean;force?:boolean}){call({op:'rm',path:toPath(path),recursive:!!options?.recursive,force:!!options?.force});}
export function rmdirSync(path:unknown,options?:{recursive?:boolean}){call({op:'rm',path:toPath(path),recursive:!!options?.recursive,force:false});}
export function renameSync(from:unknown,to:unknown){call({op:'rename',from:toPath(from),to:toPath(to)});}
export function copyFileSync(from:unknown,to:unknown,mode=0){call({op:'copy',from:toPath(from),to:toPath(to),exclusive:(mode&1)===1});}
export function realpathSync(path:unknown){const at=toPath(path);call({op:'stat',path:at});return at;}
realpathSync.native=realpathSync;
export const constants={F_OK:0,R_OK:4,W_OK:2,X_OK:1,COPYFILE_EXCL:1,COPYFILE_FICLONE:2,O_RDONLY:0,O_WRONLY:1,O_RDWR:2,O_CREAT:64,O_EXCL:128};

/** File descriptors: the storage worker's descriptor (which holds a file opened for writing), and this side's position.
 * The project lock opens with 'wx'; fingerprints read in pieces; programs that seek (ffmpeg, Python in the sandbox)
 * read and write at positions. */
const descriptors=new Map<number,{path:string;position:number;remote:number;append:boolean}>();let nextFd=3;
const descriptor=(fd:number)=>{const found=descriptors.get(fd);if(!found)fail({code:'EBADF',message:'EBADF: bad file descriptor'});return found;};
/** node's numeric open flags as the string ones. */
const flagName=(flags:number)=>{const access=flags&3,create=flags&64,exclusive=flags&128,truncate=flags&512,append=flags&1024;
 if(append)return access===2?'a+':'a';if(exclusive)return access===2?'wx+':'wx';if(truncate||create)return access===2?'w+':'w';return access===2?'r+':access===1?'r+':'r';};
export function openSync(path:unknown,flags:string|number='r'){
 const at=toPath(path),flag=typeof flags==='number'?flagName(flags):flags;
 const remote=call({op:'open',path:at,flags:flag}).json.fd as number,fd=nextFd++;descriptors.set(fd,{path:at,position:0,remote,append:flag.startsWith('a')});return fd;
}
export function closeSync(fd:number){const d=descriptors.get(fd);if(!d)return;descriptors.delete(fd);call({op:'close',fd:d.remote});}
export function fstatSync(fd:number){return statSync(descriptor(fd).path)!;}
export function readSync(fd:number,buffer:Uint8Array,offset=0,length=buffer.byteLength-offset,position:number|bigint|null=null){
 const d=descriptor(fd),at=position===null||position===undefined?d.position:Number(position);let total=0;
 while(total<length){const {data}=call({op:'pread',fd:d.remote,position:at+total,length:length-total});if(!data?.length)break;buffer.set(data,offset+total);total+=data.length;}
 if(position===null||position===undefined)d.position+=total;return total;
}
/** writeSync(fd, buffer, offset?, length?, position?) and writeSync(fd, string, position?, encoding?), as in node. */
export function writeSync(fd:number,data:unknown,a?:number|null,b?:number|string|null,c?:number|null){
 const d=descriptor(fd);let chunk:Uint8Array,position:number|null|undefined;
 if(typeof data==='string'){chunk=toBytes(data,typeof b==='string'?b:undefined);position=a;}
 else{const all=toBytes(data),offset=a??0;chunk=all.subarray(offset,offset+(typeof b==='number'?b:all.length-offset));position=c;}
 const at=d.append?null:position??d.position;call({op:'pwrite',fd:d.remote,position:at,data:chunk});
 if(position===null||position===undefined)d.position+=chunk.length;return chunk.length;
}
export function ftruncateSync(fd:number,length=0){call({op:'ftruncate',fd:descriptor(fd).remote,length});}

/** Streams, enough for the project service: reading in pieces (for await, pipeline) and writing in appends. */
type Listener=(...args:any[])=>void;
class Emitter{private listeners=new Map<string,Listener[]>();on(type:string,fn:Listener){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);return this;}once(type:string,fn:Listener){const wrap=(...a:any[])=>{this.off(type,wrap);fn(...a);};return this.on(type,wrap);}off(type:string,fn:Listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(f=>f!==fn));return this;}removeListener(type:string,fn:Listener){return this.off(type,fn);}emit(type:string,...args:any[]){for(const fn of this.listeners.get(type)??[])fn(...args);return(this.listeners.get(type)?.length??0)>0;}}
/** A turn of the worker's event loop. Each read blocks the worker until the storage worker answers, so a stream read
 * that only awaited a microtask between pieces kept the worker from every message until the whole file was read: an
 * import's copy held up the next import, its state and every command behind it. */
const turns=new MessageChannel(),waiting:(()=>void)[]=[];turns.port1.onmessage=()=>waiting.shift()?.();
const nextTurn=()=>new Promise<void>(resolve=>{waiting.push(resolve);turns.port2.postMessage(0);});
export class ReadStream extends Emitter{
 readonly path:string;private position:number;private end:number;private chunk:number;destroyed=false;
 constructor(path:unknown,options?:{start?:number;end?:number;highWaterMark?:number}){super();this.path=toPath(path);this.position=options?.start??0;this.end=options?.end===undefined?Infinity:options.end+1;this.chunk=Math.min(options?.highWaterMark??1024*1024,CAPACITY-4096);}
 private flowing=false;
 // Listening for 'data' starts the flow, as in Node.
 override on(type:string,fn:Listener){super.on(type,fn);if(type==='data'&&!this.flowing){this.flowing=true;void this.flow();}return this;}
 private async flow(){try{for await(const chunk of this)this.emit('data',chunk);this.emit('end');this.emit('close');}catch(error){this.emit('error',error);}}
 async*[Symbol.asyncIterator](){
  while(!this.destroyed&&this.position<this.end){const {json,data}=readRange(this.path,this.position,Math.min(this.chunk,this.end-this.position));if(!data?.length)break;this.position+=data.length;yield Buffer.from(data.buffer,data.byteOffset,data.byteLength);if(this.position>=json.size)break;await nextTurn();}
 }
 destroy(){this.destroyed=true;return this;}
}
export class WriteStream extends Emitter{
 readonly path:string;private started=false;bytesWritten=0;
 constructor(path:unknown,private options?:{flags?:string}){super();this.path=toPath(path);}
 write(chunk:unknown,encoding?:unknown,callback?:Listener){if(typeof encoding==='function')callback=encoding as Listener;try{const data=toBytes(chunk,typeof encoding==='string'?encoding:undefined);writeAll(this.path,data,this.started?'a':this.options?.flags==='wx'?'wx':this.options?.flags==='a'?'a':'w');this.started=true;this.bytesWritten+=data.length;callback?.();}catch(error){callback?.(error);this.emit('error',error);return false;}return true;}
 end(chunk?:unknown,encoding?:unknown,callback?:Listener){if(typeof chunk==='function'){callback=chunk as Listener;chunk=undefined;}if(chunk!==undefined&&chunk!==null)this.write(chunk,encoding);else if(!this.started){writeAll(this.path,new Uint8Array(),this.options?.flags==='wx'?'wx':'w');this.started=true;}queueMicrotask(()=>{this.emit('finish');this.emit('close');callback?.();});return this;}
 destroy(){return this;}
}
export const createReadStream=(path:unknown,options?:{start?:number;end?:number;highWaterMark?:number})=>new ReadStream(path,options);
export const createWriteStream=(path:unknown,options?:{flags?:string})=>new WriteStream(path,options);
const unsupported=(name:string)=>()=>{throw new Error(`fs.${name} is not available in the browser.`);};
export const watch=unsupported('watch'),symlinkSync=unsupported('symlinkSync'),linkSync=unsupported('linkSync'),chmodSync=()=>undefined,utimesSync=()=>undefined;
export const promises={} as Record<string,unknown>;
export default {statSync,lstatSync,existsSync,accessSync,readdirSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,appendFileSync,unlinkSync,rmSync,rmdirSync,renameSync,copyFileSync,realpathSync,openSync,closeSync,fstatSync,readSync,writeSync,ftruncateSync,createReadStream,createWriteStream,constants,watch,promises};
