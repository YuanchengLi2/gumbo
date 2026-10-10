import {randomUUID} from 'node:crypto';
import {VisualRenderResultSchema,VisualProgressSchema,type VisualRenderer} from '@dream/contracts';
export function visualClient(port:{postMessage:(value:unknown)=>void}){
 const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;progress?:Parameters<VisualRenderer>[2]}>();
 const render:VisualRenderer=(request,signal,progress)=>new Promise((resolve,reject)=>{
  signal.throwIfAborted();const id=randomUUID(),cleanup=()=>{clearTimeout(timer);pending.delete(id);signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();port.postMessage({visualCancel:id});reject(new DOMException('Animation creation canceled','AbortError'));};
  const timer=setTimeout(()=>{cleanup();port.postMessage({visualCancel:id});reject(new Error('Animation capture timed out. Resume to retry.'));},11*60_000);
  pending.set(id,{progress,resolve:value=>{cleanup();try{resolve(VisualRenderResultSchema.parse(value));}catch(error){reject(error);}},reject:error=>{cleanup();reject(error);}});signal.addEventListener('abort',abort,{once:true});port.postMessage({visual:{id,request}});
 });
 return{render,progress:(response:{id:string;progress:unknown})=>{const value=VisualProgressSchema.safeParse(response.progress);if(value.success)pending.get(response.id)?.progress?.(value.data);},receive:(response:{id:string;result?:unknown;error?:string})=>{const p=pending.get(response.id);if(p)response.error?p.reject(new Error(response.error)):p.resolve(response.result);}};
}
