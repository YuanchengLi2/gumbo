import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,renameSync,statSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export type Download={id:string;url:string;sha256:string;bytes:number;filename:string};
export async function fileHash(path:string,signal?:AbortSignal){const hash=createHash('sha256');for await(const chunk of createReadStream(path)){signal?.throwIfAborted();hash.update(chunk);}return hash.digest('hex');}
export async function downloadVerified(entry:Download,destination:string,signal:AbortSignal,progress:(status:string,bytes:number)=>void){
 mkdirSync(dirname(destination),{recursive:true});const part=destination+'.part';
 const valid=async(path:string)=>existsSync(path)&&statSync(path).size===entry.bytes&&await fileHash(path,signal)===entry.sha256;
 if(await valid(destination)){progress('ready',entry.bytes);return destination;}
 if(await valid(part)){renameSync(part,destination);progress('ready',entry.bytes);return destination;}
 let offset=existsSync(part)?statSync(part).size:0;
 if(offset>=entry.bytes){unlinkSync(part);offset=0;}
 const response=await fetch(entry.url,{headers:offset?{Range:`bytes=${offset}-`}:{},signal});
 if(!response.ok||!response.body)throw new Error(`Model download failed (${response.status}).`);
 if(offset&&response.status!==206)offset=0;
 if(response.status===206&&!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))throw new Error('The model server returned an incorrect resume range.');
 let loaded=offset,last=0;progress('downloading',loaded);
 const count=new Transform({transform(chunk,_encoding,callback){loaded+=chunk.length;if(loaded>entry.bytes){callback(new Error('Model download exceeded its declared size.'));return;}if(Date.now()-last>250){last=Date.now();progress('downloading',loaded);}callback(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body as any),count,createWriteStream(part,{flags:offset?'a':'w'}),{signal});
 progress('verifying',loaded);
 if(!await valid(part)){unlinkSync(part);throw new Error('Model size or checksum did not match. Retry the download.');}
 signal.throwIfAborted();renameSync(part,destination);progress('ready',entry.bytes);return destination;
}
