import {RenderedScoreSchema,type RenderedScore} from '../../../project-service/src/procedural-client';
export {RenderedScoreSchema,type RenderedScore} from '../../../project-service/src/procedural-client';
import type {ScoreDocument,SoundDesign} from '@dream/procedural-media';

/** Music and sound effects on the web: the desktop renders them in a worker thread (procedural-client.ts); here a web
 * worker of the project worker does (procedural.worker.ts), with the same deadline, cancelling and checks. The worker's
 * path the desktop passes is not needed. Without this every score and sound effect failed, and Roux kept retrying. */
export function renderProcedural(_workerPath:string,input:{directory:string;score?:ScoreDocument;sound?:SoundDesign;sfxId?:string;stems?:boolean},signal:AbortSignal,progress:(value:number)=>void){
 return new Promise<RenderedScore>((resolve,reject)=>{
  signal.throwIfAborted();let settled=false;
  const worker=new Worker(new URL('./procedural.worker.ts',import.meta.url),{type:'module',name:'gumbo-procedural'});
  const finish=(error?:Error,value?:RenderedScore)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);clearTimeout(timer);worker.terminate();if(error)reject(error);else resolve(value!);};
  const abort=()=>finish(new DOMException('Music generation canceled','AbortError'));
  const timer=setTimeout(()=>finish(new Error('Audio generation exceeded its processing deadline.')),10*60_000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data:message})=>{if(message.error)finish(new Error(message.error));else if(message.complete){try{finish(undefined,RenderedScoreSchema.parse(message.complete));}catch(error){finish(error as Error);}}else if(typeof message.progress==='number')progress(Math.max(0,Math.min(1,message.progress)));};
  worker.onerror=event=>{event.preventDefault();finish(new Error(`The audio worker stopped: ${event.message||'it could not start'}`));};
  worker.postMessage(input);
 });
}
