import {randomUUID} from 'node:crypto';
import type {FileRequest,FileResponse} from '@dream/contracts';
export function fileClient(port:{postMessage:(value:unknown)=>void}){
 const pending=new Map<string,{resolve:(value:FileResponse)=>void;reject:(error:Error)=>void}>();
 return {
  request(request:FileRequest,context:{projectId:string;turnId?:string},signal?:AbortSignal):Promise<FileResponse>{return new Promise((resolve,reject)=>{signal?.throwIfAborted();const id=randomUUID();const cleanup=()=>{pending.delete(id);signal?.removeEventListener('abort',abort);};const abort=()=>{cleanup();port.postMessage({fileCancel:id});reject(new DOMException('File request canceled','AbortError'));};pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}});signal?.addEventListener('abort',abort,{once:true});port.postMessage({file:{id,request,context}});});},
  receive(value:{id:string;result?:FileResponse;error?:string}){const p=pending.get(value.id);if(p)value.error?p.reject(new Error(value.error)):p.resolve(value.result!);},
  close(){for(const p of [...pending.values()])p.reject(new Error('Project closed.'));}
 };
}
