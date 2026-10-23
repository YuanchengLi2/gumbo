/// <reference lib="webworker" />
import {exportSound,type SoundRequest} from './sound';

/** The export's sound, mixed and encoded off the page (sound.ts). Messages: {id,request} to start, {cancel:id} to stop;
 * answers {id,result} (false when there is no sound) or {id,error}. */
const running=new Map<string,AbortController>();
const post=(message:unknown)=>(self as unknown as Worker).postMessage(message);
self.onmessage=async(event:MessageEvent<{id:string;request:SoundRequest}|{cancel:string}>)=>{
 const data=event.data;
 if('cancel' in data){running.get(data.cancel)?.abort();return;}
 const abort=new AbortController();running.set(data.id,abort);
 try{post({id:data.id,result:await exportSound(data.request,abort.signal)});}
 catch(error){post({id:data.id,error:abort.signal.aborted?'cancelled':String((error as Error)?.message??error)});}
 finally{running.delete(data.id);}
};
