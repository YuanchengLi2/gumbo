import {readdir,stat,rm,utimes} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
const leases=new Map<string,number>();
export async function touchCache(path:string){leases.set(resolve(path),Date.now());await utimes(path,new Date(),new Date()).catch(()=>{});}
/** Only disposable renderer output is eligible; project media and source never enter this root. */
export async function pruneVisualCache(root:string,maxBytes=5*1024**3){
 const absolute=resolve(root),entries=await readdir(absolute,{withFileTypes:true}).catch(()=>[]),candidates:{path:string;bytes:number;time:number}[]=[];
 for(const entry of entries){if(!/^(?:[a-f0-9]{64}(?:\.json)?|compiled-[a-f0-9]{64}\.json)$/.test(entry.name))continue;const path=join(absolute,entry.name);const info=await stat(path).catch(()=>null);if(!info)continue;let bytes=info.size;if(entry.isDirectory()){bytes=0;for(const child of await readdir(path)){const file=await stat(join(path,child)).catch(()=>null);if(file?.isFile())bytes+=file.size;}}candidates.push({path,bytes,time:Math.max(info.mtimeMs,leases.get(resolve(path))??0)});}
 let bytes=candidates.reduce((sum,c)=>sum+c.bytes,0);
 for(const candidate of candidates.sort((a,b)=>a.time-b.time)){if(bytes<=maxBytes)break;if(Date.now()-candidate.time<10*60_000)continue;const rel=relative(absolute,resolve(candidate.path));if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('Cache cleanup escaped its root.');await rm(candidate.path,{recursive:true,force:true,maxRetries:2,retryDelay:100});leases.delete(resolve(candidate.path));bytes-=candidate.bytes;}
 return{bytes,limit:maxBytes};
}
