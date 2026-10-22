import type {FileHandle,FileStat,OpenFlags,SandboxFS} from './types';

/** The synchronous part of the node:fs API the sandbox calls. ZenFS's `fs` has it (the web app's OPFS-backed one in a
 * worker), and so does Node's own `fs`, which the tests use to check this adapter against a real disk. */
export interface NodeLikeFS{
 statSync(path:string):NodeStats;
 lstatSync(path:string):NodeStats;
 readdirSync(path:string):string[];
 mkdirSync(path:string,options?:{recursive?:boolean}):unknown;
 readFileSync(path:string):Uint8Array;
 writeFileSync(path:string,data:Uint8Array):void;
 appendFileSync(path:string,data:Uint8Array):void;
 unlinkSync(path:string):void;
 rmdirSync(path:string):void;
 renameSync(from:string,to:string):void;
 openSync(path:string,flags:string):number;
 readSync(fd:number,buffer:Uint8Array,offset:number,length:number,position:number):number;
 writeSync(fd:number,buffer:Uint8Array,offset:number,length:number,position?:number|null):number;
 fstatSync(fd:number):{size:number};
 ftruncateSync(fd:number,length?:number):void;
 closeSync(fd:number):void;
 utimesSync?(path:string,atime:number|Date,mtime:number|Date):void;
 chmodSync?(path:string,mode:number):void;
 readlinkSync?(path:string):string|Uint8Array;
 symlinkSync?(target:string,path:string):void;
}
interface NodeStats{size:number|bigint;mtimeMs:number|bigint;mode:number|bigint;isFile():boolean;isDirectory():boolean;isSymbolicLink():boolean}

const bytes=(data:Uint8Array)=>data.constructor===Uint8Array?data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
const stat=(s:NodeStats):FileStat=>({type:s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'file',size:Number(s.size),mtimeMs:Number(s.mtimeMs),mode:Number(s.mode)&0o7777});

/** Wraps a node:fs-like file system (ZenFS in the web app) as the sandbox's file system. `prefix` maps the sandbox's "/"
 * onto a folder of it, for a host whose ZenFS holds more than the sandbox may see. */
export function nodeLikeFS(fs:NodeLikeFS,prefix=''):SandboxFS{
 const at=(path:string)=>prefix?prefix.replace(/\/+$/,'')+(path==='/'?'':path):path;
 return{
  stat:path=>stat(fs.statSync(at(path))),
  lstat:path=>stat(fs.lstatSync(at(path))),
  readdir:path=>fs.readdirSync(at(path)).map(String).sort(),
  mkdir:(path,recursive)=>{fs.mkdirSync(at(path),{recursive:!!recursive});},
  readFile:path=>bytes(fs.readFileSync(at(path))),
  writeFile:(path,data)=>fs.writeFileSync(at(path),data),
  appendFile:(path,data)=>fs.appendFileSync(at(path),data),
  unlink:path=>fs.unlinkSync(at(path)),
  rmdir:path=>fs.rmdirSync(at(path)),
  rename:(from,to)=>fs.renameSync(at(from),at(to)),
  open:(path,flags:OpenFlags):FileHandle=>{
   const fd=fs.openSync(at(path),flags),append=flags[0]==='a';let closed=false;
   return{
    read:(buffer,position)=>fs.readSync(fd,buffer,0,buffer.length,position),
    // Appends pass no position: a positioned write on an "a" descriptor is ignored on some systems and honoured on others.
    write:(data,position)=>{let done=0;while(done<data.length)done+=fs.writeSync(fd,data,done,data.length-done,append?null:position+done);return done;},
    size:()=>Number(fs.fstatSync(fd).size),
    truncate:length=>fs.ftruncateSync(fd,length),
    close:()=>{if(!closed){closed=true;fs.closeSync(fd);}}
   };
  },
  utimes:fs.utimesSync?(path,mtimeMs)=>fs.utimesSync!(at(path),new Date(mtimeMs),new Date(mtimeMs)):undefined,
  chmod:fs.chmodSync?(path,mode)=>fs.chmodSync!(at(path),mode):undefined,
  readlink:fs.readlinkSync?path=>String(fs.readlinkSync!(at(path))):undefined,
  symlink:fs.symlinkSync?(target,path)=>fs.symlinkSync!(target,at(path)):undefined
 };
}
