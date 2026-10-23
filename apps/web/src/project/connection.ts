/** The account's connection (the gateway's address and a fresh token) for the web's own modules in the project worker,
 * asked of the page with the message the project service uses (connection-client.ts); the answers to these questions
 * are taken here and the rest go on to the service. */
type Connection={url:string;token:string;accountId?:string};
const pending=new Map<string,{resolve:(value:Connection)=>void;reject:(error:Error)=>void}>();
export function gatewayConnection(signal?:AbortSignal):Promise<Connection>{
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();const id='web-'+crypto.randomUUID(),abort=()=>{pending.delete(id);reject(signal!.reason);};
  pending.set(id,{resolve:value=>{signal?.removeEventListener('abort',abort);resolve(value);},reject:error=>{signal?.removeEventListener('abort',abort);reject(error);}});
  signal?.addEventListener('abort',abort,{once:true});(self as unknown as Worker).postMessage({connection:{id}});
 });
}
/** True when the message answered one of these questions. */
export function connectionAnswer(data:any){
 const answer=data?.connectionResult,waiting=answer&&pending.get(answer.id);if(!waiting)return false;
 pending.delete(answer.id);answer.error?waiting.reject(new Error(answer.error)):waiting.resolve(answer.result);return true;
}
