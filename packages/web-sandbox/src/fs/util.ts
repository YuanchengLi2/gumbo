import {errorCode,type FileStat,type SandboxFS} from './types';
import {join,dirname} from '../path';

export const encoder=new TextEncoder();
const textDecoder=new TextDecoder();
/** Decodes bytes as UTF-8; a view on shared memory (Pyodide or ffmpeg with threads) is copied first, as TextDecoder needs. */
export const decode=(data:Uint8Array)=>textDecoder.decode(typeof SharedArrayBuffer!=='undefined'&&data.buffer instanceof SharedArrayBuffer?data.slice():data);
export function tryStat(fs:SandboxFS,path:string):FileStat|undefined{try{return fs.stat(path);}catch(error){const code=errorCode(error);if(code==='ENOENT'||code==='ENOTDIR')return undefined;throw error;}}
export const exists=(fs:SandboxFS,path:string)=>!!tryStat(fs,path);
export const isDir=(fs:SandboxFS,path:string)=>tryStat(fs,path)?.type==='directory';
export const readText=(fs:SandboxFS,path:string)=>decode(fs.readFile(path));
export const writeText=(fs:SandboxFS,path:string,text:string)=>fs.writeFile(path,encoder.encode(text));
export function mkdirp(fs:SandboxFS,path:string){if(!isDir(fs,path))fs.mkdir(path,true);}
/** Removes a file or a whole folder. */
export function removeTree(fs:SandboxFS,path:string){
 const stat=fs.lstat?.(path)??fs.stat(path);
 if(stat.type==='directory'){for(const name of fs.readdir(path))removeTree(fs,join(path,name));fs.rmdir(path);}else fs.unlink(path);
}
/** Copies a file in 4 MB pieces, so a large video is never held in memory whole. */
export function copyFile(fs:SandboxFS,from:string,to:string){
 const source=fs.open(from,'r');
 try{const target=fs.open(to,'w');try{const buffer=new Uint8Array(4<<20);let position=0,n:number;while((n=source.read(buffer,position))>0){target.write(n===buffer.length?buffer:buffer.subarray(0,n),position);position+=n;}}finally{target.close();}}
 finally{source.close();}
 const mtime=fs.stat(from).mtimeMs;fs.utimes?.(to,mtime);
}
export function copyTree(fs:SandboxFS,from:string,to:string){
 const stat=fs.stat(from);if(stat.type!=='directory'){copyFile(fs,from,to);return;}
 mkdirp(fs,to);for(const name of fs.readdir(from))copyTree(fs,join(from,name),join(to,name));
}
/** Every path under a folder, depth first, the folder itself first. */
export function*walk(fs:SandboxFS,path:string,depth=0):Generator<{path:string;stat:FileStat;depth:number}>{
 const stat=fs.lstat?.(path)??fs.stat(path);yield{path,stat,depth};
 if(stat.type==='directory')for(const name of fs.readdir(path))yield*walk(fs,path==='/'?'/'+name:path+'/'+name,depth+1);
}
export function ensureParent(fs:SandboxFS,path:string){mkdirp(fs,dirname(path));}
