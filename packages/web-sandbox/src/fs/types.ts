/** The one interface the sandbox needs from a file system. It is synchronous on purpose: Python's and ffmpeg's own file
 * calls (Emscripten) are synchronous, so the file system they read through must be too. In a worker, ZenFS gives exactly
 * this over OPFS; tests use the in-memory one. Paths are absolute POSIX paths in the sandbox's namespace. */
export type FileType='file'|'directory'|'symlink';
export interface FileStat{type:FileType;size:number;mtimeMs:number;mode:number}
export type OpenFlags='r'|'r+'|'w'|'w+'|'a'|'a+';
/** An open file for reading and writing at positions, so big media is never read whole into memory. */
export interface FileHandle{
 read(buffer:Uint8Array,position:number):number;
 write(data:Uint8Array,position:number):number;
 size():number;
 truncate(length:number):void;
 close():void;
}
export interface SandboxFS{
 stat(path:string):FileStat;
 lstat?(path:string):FileStat;
 readdir(path:string):string[];
 mkdir(path:string,recursive?:boolean):void;
 readFile(path:string):Uint8Array;
 writeFile(path:string,data:Uint8Array):void;
 appendFile(path:string,data:Uint8Array):void;
 unlink(path:string):void;
 rmdir(path:string):void;
 rename(from:string,to:string):void;
 open(path:string,flags:OpenFlags):FileHandle;
 utimes?(path:string,mtimeMs:number):void;
 chmod?(path:string,mode:number):void;
 readlink?(path:string):string;
 symlink?(target:string,path:string):void;
 /** Bytes held in memory by this file system, for the memory guard (an in-memory file system counts; OPFS does not). */
 memoryBytes?():number;
}
export type FsCode='ENOENT'|'EEXIST'|'ENOTDIR'|'EISDIR'|'ENOTEMPTY'|'EINVAL'|'EBADF'|'EPERM'|'EACCES'|'EIO'|'EXDEV'|'ELOOP';
const messages:Record<FsCode,string>={ENOENT:'no such file or directory',EEXIST:'file already exists',ENOTDIR:'not a directory',EISDIR:'is a directory',ENOTEMPTY:'directory not empty',EINVAL:'invalid argument',EBADF:'bad file descriptor',EPERM:'operation not permitted',EACCES:'permission denied',EIO:'i/o error',EXDEV:'cross-device link',ELOOP:'too many symbolic links'};
export class FsError extends Error{
 constructor(public code:FsCode,public path:string,syscall='access'){super(`${code}: ${messages[code]}, ${syscall} '${path}'`);}
}
/** The error code of anything a file system threw (ours, ZenFS's or Node's), or undefined. */
export const errorCode=(error:unknown):string|undefined=>(error as any)?.code;
/** "No such file or directory" style text for tool messages, from any file system's error. */
export function describeError(error:unknown){
 const code=errorCode(error) as FsCode|undefined;return code&&messages[code]?messages[code][0].toUpperCase()+messages[code].slice(1):String((error as Error)?.message??error);
}
