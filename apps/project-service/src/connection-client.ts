import {randomUUID} from 'node:crypto';
import {AIConnectionSchema,type AIConnection} from '@dream/contracts';

/** Credentials are requested from the main process per inference, never from project storage. */
export function connectionClient(port:{postMessage:(message:unknown)=>void},timeoutMs=20_000){
 const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
 return{
  request(signal?:AbortSignal):Promise<AIConnection>{return new Promise((resolve,reject)=>{
   signal?.throwIfAborted();const id=randomUUID();
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);};
   const abort=()=>{cleanup();reject(new DOMException('Canceled','AbortError'));};
   const timer=setTimeout(()=>{cleanup();reject(new Error('Account connection check timed out. Saved work is unchanged.'));},timeoutMs);
   pending.set(id,{resolve:value=>{cleanup();try{resolve(AIConnectionSchema.parse(value));}catch(error){reject(error);}},reject:error=>{cleanup();reject(error);}});
   signal?.addEventListener('abort',abort,{once:true});try{port.postMessage({connection:{id}});}catch(error){cleanup();reject(error);}
  });},
  receive(response:{id:string;result?:unknown;error?:string}){const request=pending.get(response.id);if(request)response.error?request.reject(new Error(response.error)):request.resolve(response.result);},
  close(){for(const request of [...pending.values()])request.reject(new Error('Project service closed.'));}
 };
}
