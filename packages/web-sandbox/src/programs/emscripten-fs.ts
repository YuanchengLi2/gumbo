import type {FileHandle,FileStat,SandboxFS} from '../fs/types';
import {join} from '../path';

/** Emscripten's errno numbers (the WASI ones, used since Emscripten 2), for builds that do not export ERRNO_CODES. */
const ERRNO:Record<string,number>={EPERM:63,ENOENT:44,EIO:29,EBADF:8,EACCES:2,EEXIST:20,ENOTDIR:54,EISDIR:31,EINVAL:28,ENOTEMPTY:55,EXDEV:75,ELOOP:32,ENODEV:43,ENOSYS:52,ENOTSUP:138};
const S_IFDIR=0o040000,S_IFREG=0o100000,S_IFLNK=0o120000;
const modeOf=(s:FileStat)=>(s.type==='directory'?S_IFDIR:s.type==='symlink'?S_IFLNK:S_IFREG)|((s.mode&0o7777)||(s.type==='directory'?0o755:0o644));
type Node={name:string;parent:Node;mode:number;id:number;mount:{opts:{root:string}};node_ops:unknown;stream_ops:unknown};
type Stream={node:Node;flags:number;position:number;sandboxFile?:{handle:FileHandle|null;refs:number}};

/** A file system for an Emscripten module (Pyodide, ffmpeg.wasm) that reads and writes the sandbox's own files, so
 * Python's open() and ffmpeg's output land where the shell sees them: no copying in or out, and a 2 GB source is read
 * piece by piece. Modelled on Emscripten's NODEFS. */
export function sandboxFS(FS:any,fs:SandboxFS,codes:Record<string,number>=ERRNO){
 const errno=(error:unknown)=>{if(error instanceof FS.ErrnoError)return error;const code=(error as {code?:string})?.code;return new FS.ErrnoError(codes[code??'']??ERRNO[code??'']??codes.EIO??ERRNO.EIO);};
 const attempt=<T>(f:()=>T):T=>{try{return f();}catch(error){throw errno(error);}};
 const realPath=(node:Node)=>{const parts:string[]=[];while(node.parent!==node){parts.push(node.name);node=node.parent;}parts.push(node.mount.opts.root);parts.reverse();return join(...parts);};
 const stat=(path:string)=>fs.lstat?fs.lstat(path):fs.stat(path);
 const nodeOps={
  getattr(node:Node){
   const s=attempt(()=>stat(realPath(node))),time=new Date(s.mtimeMs);
   return{dev:7,ino:node.id,mode:modeOf(s),nlink:1,uid:0,gid:0,rdev:0,size:s.type==='directory'?4096:s.size,atime:time,mtime:time,ctime:time,blksize:4096,blocks:Math.ceil(s.size/512)};
  },
  setattr(node:Node,attr:{mode?:number;size?:number;timestamp?:number;mtime?:number|Date;atime?:number|Date}){
   const path=realPath(node);
   attempt(()=>{
    if(attr.mode!==undefined){fs.chmod?.(path,attr.mode);node.mode=attr.mode;}
    if(attr.size!==undefined){const h=fs.open(path,'r+');try{h.truncate(attr.size);}finally{h.close();}}
    const time=attr.mtime??attr.timestamp;if(time!==undefined)fs.utimes?.(path,time instanceof Date?time.getTime():Number(time));
   });
  },
  lookup(parent:Node,name:string){const s=attempt(()=>stat(join(realPath(parent),name)));return create(parent,name,modeOf(s),0);},
  mknod(parent:Node,name:string,mode:number,dev:number){
   const node=create(parent,name,mode,dev),path=realPath(node);
   attempt(()=>{if(FS.isDir(node.mode))fs.mkdir(path,false);else if(FS.isFile(node.mode))fs.writeFile(path,new Uint8Array());else throw Object.assign(new Error('unsupported node'),{code:'EPERM'});});
   return node;
  },
  rename(oldNode:Node,newDir:Node,newName:string){attempt(()=>fs.rename(realPath(oldNode),join(realPath(newDir),newName)));oldNode.name=newName;},
  unlink(parent:Node,name:string){attempt(()=>fs.unlink(join(realPath(parent),name)));},
  rmdir(parent:Node,name:string){attempt(()=>fs.rmdir(join(realPath(parent),name)));},
  readdir(node:Node){return attempt(()=>fs.readdir(realPath(node)));},
  symlink(parent:Node,name:string,target:string){attempt(()=>{if(!fs.symlink)throw Object.assign(new Error('no symlinks'),{code:'EPERM'});fs.symlink(target,join(realPath(parent),name));});},
  readlink(node:Node){return attempt(()=>{if(!fs.readlink)throw Object.assign(new Error('no symlinks'),{code:'EINVAL'});return fs.readlink(realPath(node));});}
 };
 const streamOps={
  open(stream:Stream){
   if(!FS.isFile(stream.node.mode))return;
   // O_CREAT and O_TRUNC were already done by FS.open through mknod and setattr; here the file only opens.
   const access=stream.flags&3;stream.sandboxFile={handle:attempt(()=>fs.open(realPath(stream.node),access===0?'r':'r+')),refs:1};
  },
  dup(stream:Stream){if(stream.sandboxFile)stream.sandboxFile.refs++;},
  close(stream:Stream){const s=stream.sandboxFile;if(s&&--s.refs<=0&&s.handle){const h=s.handle;s.handle=null;attempt(()=>h.close());}},
  read(stream:Stream,buffer:Uint8Array,offset:number,length:number,position:number){
   if(length===0)return 0;const handle=stream.sandboxFile?.handle;if(!handle)throw new FS.ErrnoError(codes.EBADF??ERRNO.EBADF);
   return attempt(()=>handle.read(new Uint8Array(buffer.buffer,buffer.byteOffset+offset,length),position));
  },
  write(stream:Stream,buffer:Uint8Array,offset:number,length:number,position:number){
   if(length===0)return 0;const handle=stream.sandboxFile?.handle;if(!handle)throw new FS.ErrnoError(codes.EBADF??ERRNO.EBADF);
   return attempt(()=>handle.write(new Uint8Array(buffer.buffer,buffer.byteOffset+offset,length),position));
  },
  llseek(stream:Stream,offset:number,whence:number){
   let position=offset;if(whence===1)position+=stream.position;else if(whence===2&&FS.isFile(stream.node.mode))position+=attempt(()=>stream.sandboxFile?.handle?.size()??stat(realPath(stream.node)).size);
   if(position<0)throw new FS.ErrnoError(codes.EINVAL??ERRNO.EINVAL);return position;
  }
 };
 const create=(parent:Node|null,name:string,mode:number,dev:number):Node=>{const node=FS.createNode(parent,name,mode,dev);node.node_ops=nodeOps;node.stream_ops=streamOps;return node;};
 return{mount:(mount:{opts:{root:string}})=>create(null,'/',S_IFDIR|0o777,0)};
}
/** Mounts the sandbox's folder at the same path inside an Emscripten module, once. */
export function mountSandbox(FS:any,fs:SandboxFS,path:string,codes?:Record<string,number>){
 const mounted:Set<string>=(FS.__sandboxMounts??=new Set());if(mounted.has(path))return;
 FS.mkdirTree(path);FS.mount(sandboxFS(FS,fs,codes),{root:path},path);mounted.add(path);
}
