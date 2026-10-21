import {randomUUID} from 'node:crypto';
import {AIConnectionSchema,type AIConnection} from '@dream/contracts';

const TIMED_OUT='Account connection check timed out. Saved work is unchanged.';

/** Credentials are requested from the main process per inference, never from project storage. One slow answer (a busy
 * main process, a sign-in refresh on a flaky network) used to end the whole request: twice on October 20-21 an edit
 * stopped with "Account connection check timed out" minutes in. A timed-out check is now asked again, with more time,
 * before it fails the request. */
export function connectionClient(port:{postMessage:(message:unknown)=>void},timeoutMs=20_000,attempts=3){
 const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
 const once=(signal:AbortSignal|undefined,wait:number):Promise<AIConnection>=>new Promise((resolve,reject)=>{
  signal?.throwIfAborted();const id=randomUUID();
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);};
  const abort=()=>{cleanup();reject(new DOMException('Canceled','AbortError'));};
  const timer=setTimeout(()=>{cleanup();reject(new Error(TIMED_OUT));},wait);
  pending.set(id,{resolve:value=>{cleanup();try{resolve(AIConnectionSchema.parse(value));}catch(error){reject(error);}},reject:error=>{cleanup();reject(error);}});
  signal?.addEventListener('abort',abort,{once:true});try{port.postMessage({connection:{id}});}catch(error){cleanup();reject(error);}
 });
 return{
  async request(signal?:AbortSignal):Promise<AIConnection>{
   for(let attempt=1;;attempt++){
    try{return await once(signal,timeoutMs*attempt);}
    catch(error){if(attempt>=attempts||(error as Error).message!==TIMED_OUT)throw error;}
   }
  },
  receive(response:{id:string;result?:unknown;error?:string}){const request=pending.get(response.id);if(request)response.error?request.reject(new Error(response.error)):request.resolve(response.result);},
  close(){for(const request of [...pending.values()])request.reject(new Error('Project service closed.'));}
 };
}
