import {FsError,type FileHandle,type FileStat,type OpenFlags,type SandboxFS} from './types';
import {normalize,dirname,basename} from '../path';

type Dir={kind:'directory';children:Map<string,Node>;mtimeMs:number;mode:number};
type File={kind:'file';data:Uint8Array;size:number;mtimeMs:number;mode:number};
type Link={kind:'symlink';target:string;mtimeMs:number;mode:number};
type Node=Dir|File|Link;
const dir=():Dir=>({kind:'directory',children:new Map(),mtimeMs:Date.now(),mode:0o755});

/** A file system in memory: the default for tests and for a sandbox the host has not given a real one. Files grow by
 * doubling, so ffmpeg writing an output in small pieces is not quadratic. */
export class MemoryFS implements SandboxFS{
 private root=dir();
 constructor(files:Record<string,string|Uint8Array>={}){for(const [path,content] of Object.entries(files)){this.mkdir(dirname(normalize('/'+path)),true);this.writeFile('/'+path,typeof content==='string'?new TextEncoder().encode(content):content);}}
 private walk(path:string,follow=true,depth=0):Node{
  if(depth>16)throw new FsError('ELOOP',path,'stat');
  let node:Node=this.root;const parts=normalize('/'+path).split('/').filter(Boolean);
  for(let i=0;i<parts.length;i++){
   if(node.kind==='symlink')node=this.walk(node.target,true,depth+1);
   if(node.kind!=='directory')throw new FsError('ENOTDIR',path,'stat');
   const next:Node|undefined=node.children.get(parts[i]);if(!next)throw new FsError('ENOENT',path,'stat');
   node=next.kind==='symlink'&&(follow||i<parts.length-1)?this.walk(next.target.startsWith('/')?next.target:'/'+parts.slice(0,i).join('/')+'/'+next.target,true,depth+1):next;
  }
  return node;
 }
 private parent(path:string,syscall:string){const p=normalize('/'+path);if(p==='/')throw new FsError('EPERM',path,syscall);const node=this.walk(dirname(p));if(node.kind!=='directory')throw new FsError('ENOTDIR',path,syscall);return{dir:node,name:basename(p)};}
 private file(path:string,syscall:string){const node=this.walk(path);if(node.kind==='directory')throw new FsError('EISDIR',path,syscall);return node as File;}
 stat(path:string):FileStat{const node=this.walk(path);return{type:node.kind,size:node.kind==='file'?node.size:node.kind==='symlink'?node.target.length:4096,mtimeMs:node.mtimeMs,mode:node.mode};}
 lstat(path:string):FileStat{const node=this.walk(path,false);return{type:node.kind,size:node.kind==='file'?node.size:node.kind==='symlink'?node.target.length:4096,mtimeMs:node.mtimeMs,mode:node.mode};}
 readdir(path:string){const node=this.walk(path);if(node.kind!=='directory')throw new FsError('ENOTDIR',path,'scandir');return[...node.children.keys()].sort();}
 mkdir(path:string,recursive=false){
  const parts=normalize('/'+path).split('/').filter(Boolean);let node:Dir=this.root;
  for(let i=0;i<parts.length;i++){
   let next=node.children.get(parts[i]);if(next?.kind==='symlink')next=this.walk('/'+parts.slice(0,i+1).join('/'));
   if(next){if(next.kind!=='directory')throw new FsError(i===parts.length-1&&!recursive?'EEXIST':'ENOTDIR',path,'mkdir');if(i===parts.length-1&&!recursive)throw new FsError('EEXIST',path,'mkdir');node=next;continue;}
   if(!recursive&&i<parts.length-1)throw new FsError('ENOENT',path,'mkdir');
   const made=dir();node.children.set(parts[i],made);node.mtimeMs=Date.now();node=made;
  }
 }
 readFile(path:string){const file=this.file(path,'open');return file.data.slice(0,file.size);}
 writeFile(path:string,data:Uint8Array){
  const {dir,name}=this.parent(path,'open'),old=dir.children.get(name);if(old?.kind==='directory')throw new FsError('EISDIR',path,'open');
  if(old?.kind==='symlink'){this.writeFile(old.target.startsWith('/')?old.target:dirname(normalize('/'+path))+'/'+old.target,data);return;}
  dir.children.set(name,{kind:'file',data:data.slice(),size:data.length,mtimeMs:Date.now(),mode:old?.mode??0o644});dir.mtimeMs=Date.now();
 }
 appendFile(path:string,data:Uint8Array){const handle=this.open(path,'a');try{handle.write(data,handle.size());}finally{handle.close();}}
 unlink(path:string){const {dir,name}=this.parent(path,'unlink'),node=dir.children.get(name);if(!node)throw new FsError('ENOENT',path,'unlink');if(node.kind==='directory')throw new FsError('EISDIR',path,'unlink');dir.children.delete(name);dir.mtimeMs=Date.now();}
 rmdir(path:string){const {dir,name}=this.parent(path,'rmdir'),node=dir.children.get(name);if(!node)throw new FsError('ENOENT',path,'rmdir');if(node.kind!=='directory')throw new FsError('ENOTDIR',path,'rmdir');if(node.children.size)throw new FsError('ENOTEMPTY',path,'rmdir');dir.children.delete(name);dir.mtimeMs=Date.now();}
 rename(from:string,to:string){
  const a=normalize('/'+from),b=normalize('/'+to);if(a===b)return;if(b.startsWith(a+'/'))throw new FsError('EINVAL',to,'rename');
  const source=this.parent(a,'rename'),node=source.dir.children.get(source.name);if(!node)throw new FsError('ENOENT',from,'rename');
  const target=this.parent(b,'rename'),old=target.dir.children.get(target.name);
  if(old?.kind==='directory'){if(node.kind!=='directory')throw new FsError('EISDIR',to,'rename');if(old.children.size)throw new FsError('ENOTEMPTY',to,'rename');}
  else if(old&&node.kind==='directory')throw new FsError('ENOTDIR',to,'rename');
  source.dir.children.delete(source.name);target.dir.children.set(target.name,node);source.dir.mtimeMs=target.dir.mtimeMs=Date.now();
 }
 open(path:string,flags:OpenFlags):FileHandle{
  let file:File;
  try{file=this.file(path,'open');if(flags==='w'||flags==='w+'){file.size=0;file.mtimeMs=Date.now();}}
  catch(error){if((error as FsError).code!=='ENOENT'||flags==='r'||flags==='r+')throw error;this.writeFile(path,new Uint8Array());file=this.file(path,'open');}
  let closed=false;const check=()=>{if(closed)throw new FsError('EBADF',path,'read');};
  return{
   read:(buffer,position)=>{check();const n=Math.max(0,Math.min(buffer.length,file.size-position));buffer.set(file.data.subarray(position,position+n));return n;},
   write:(data,at)=>{check();if(flags==='r')throw new FsError('EBADF',path,'write');const position=flags[0]==='a'?file.size:at,end=position+data.length;
    if(end>file.data.length){const grown=new Uint8Array(Math.max(end,Math.min(file.data.length*2,end+(256<<20)),1024));grown.set(file.data.subarray(0,file.size));file.data=grown;}
    if(position>file.size)file.data.fill(0,file.size,position);file.data.set(data,position);file.size=Math.max(file.size,end);file.mtimeMs=Date.now();return data.length;},
   size:()=>file.size,
   truncate:length=>{check();if(length>file.data.length){const grown=new Uint8Array(length);grown.set(file.data.subarray(0,file.size));file.data=grown;}else if(length>file.size)file.data.fill(0,file.size,length);file.size=length;file.mtimeMs=Date.now();},
   close:()=>{if(file.data.length>file.size*2+(1<<20))file.data=file.data.slice(0,file.size);closed=true;}
  };
 }
 utimes(path:string,mtimeMs:number){this.walk(path).mtimeMs=mtimeMs;}
 chmod(path:string,mode:number){this.walk(path).mode=mode&0o7777;}
 readlink(path:string){const node=this.walk(path,false);if(node.kind!=='symlink')throw new FsError('EINVAL',path,'readlink');return node.target;}
 symlink(target:string,path:string){const {dir,name}=this.parent(path,'symlink');if(dir.children.has(name))throw new FsError('EEXIST',path,'symlink');dir.children.set(name,{kind:'symlink',target,mtimeMs:Date.now(),mode:0o777});}
 memoryBytes(){let total=0;const visit=(node:Node)=>{if(node.kind==='file')total+=node.data.length;else if(node.kind==='directory')for(const child of node.children.values())visit(child);};visit(this.root);return total;}
}
