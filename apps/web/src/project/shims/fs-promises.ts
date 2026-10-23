import * as fs from '../fs/sync-fs';
/** node:fs/promises in the browser: the synchronous calls (sync-fs.ts) in promises, which is what they cost here anyway. */
const wrap=<A extends unknown[],R>(fn:(...args:A)=>R)=>async(...args:A):Promise<R>=>fn(...args);
export const readFile=wrap(fs.readFileSync),writeFile=wrap(fs.writeFileSync),appendFile=wrap(fs.appendFileSync),mkdir=wrap(fs.mkdirSync),readdir=wrap(fs.readdirSync),stat=wrap((p:unknown)=>fs.statSync(p)!),lstat=wrap((p:unknown)=>fs.statSync(p)!),unlink=wrap(fs.unlinkSync),rm=wrap(fs.rmSync),rmdir=wrap(fs.rmdirSync),rename=wrap(fs.renameSync),copyFile=wrap(fs.copyFileSync),realpath=wrap(fs.realpathSync),access=wrap(fs.accessSync),mkdtemp=wrap(fs.mkdtempSync);
/** A file handle (read, write, stat, close) over the synchronous descriptors. */
export async function open(path:string,flags:string='r'){
 const fd=fs.openSync(path,flags);
 return{fd,read:async(buffer:Uint8Array,offset=0,length=buffer.byteLength-offset,position:number|null=null)=>({bytesRead:fs.readSync(fd,buffer,offset,length,position),buffer}),
  write:async(data:Uint8Array|string)=>({bytesWritten:fs.writeSync(fd,data)}),stat:async()=>fs.fstatSync(fd),close:async()=>fs.closeSync(fd)};
}
/** A file, or a folder with everything in it, copied; `filter` can leave paths out (it sees each source path first). */
export async function cp(source:string,destination:string,options:{recursive?:boolean;errorOnExist?:boolean;force?:boolean;filter?:(source:string,destination:string)=>boolean|Promise<boolean>}={}){
 if(options.filter&&!await options.filter(source,destination))return;
 if(!fs.statSync(source)!.isDirectory()){if(fs.existsSync(destination)&&options.force===false){if(options.errorOnExist)throw Object.assign(new Error(`EEXIST: file already exists, cp '${destination}'`),{code:'EEXIST'});return;}fs.copyFileSync(source,destination);return;}
 if(!options.recursive)throw Object.assign(new Error(`EISDIR: ${source} is a directory (not copied)`),{code:'ERR_FS_EISDIR'});
 fs.mkdirSync(destination,{recursive:true});
 for(const name of fs.readdirSync(source) as string[])await cp(`${source}/${name}`,`${destination}/${name}`,options);
}
export default {readFile,writeFile,appendFile,mkdir,readdir,stat,lstat,unlink,rm,rmdir,rename,copyFile,realpath,access,mkdtemp,open,cp};
