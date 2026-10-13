import {Worker} from 'node:worker_threads';
import {z} from 'zod';
import type {ScoreDocument,SoundDesign} from '@dream/procedural-media';

export const RenderedScoreSchema=z.object({rendererVersion:z.string(),sha256:z.string().length(64),waveform:z.array(z.number().min(0).max(1)),stems:z.array(z.object({trackId:z.string(),filename:z.string().regex(/^stem-\d+\.wav$/),waveform:z.array(z.number().min(0).max(1)),sha256:z.string().length(64)})),durationSec:z.number().positive(),beats:z.array(z.number().nonnegative()),masterGain:z.number().positive()});
export type RenderedScore=z.infer<typeof RenderedScoreSchema>;
export function renderProcedural(workerPath:string,input:{directory:string;score?:ScoreDocument;sound?:SoundDesign;sfxId?:string;stems?:boolean},signal:AbortSignal,progress:(value:number)=>void){
 return new Promise<RenderedScore>((resolve,reject)=>{
  signal.throwIfAborted();let settled=false;
  const worker=new Worker(workerPath,{workerData:input,env:{},resourceLimits:{maxOldGenerationSizeMb:256}});
  const finish=async(error?:Error,value?:RenderedScore)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);clearTimeout(timer);await worker.terminate();if(error)reject(error);else resolve(value!);};
  const abort=()=>{void finish(new DOMException('Music generation canceled','AbortError'));};
  const timer=setTimeout(()=>{void finish(new Error('Audio generation exceeded its processing deadline.'));},10*60_000);
  signal.addEventListener('abort',abort,{once:true});
  worker.on('message',message=>{if(message.error)void finish(new Error(message.error));else if(message.complete){try{void finish(undefined,RenderedScoreSchema.parse(message.complete));}catch(error){void finish(error as Error);}}else if(typeof message.progress==='number')progress(Math.max(0,Math.min(1,message.progress)));});
  worker.once('error',error=>{void finish(error);});worker.once('exit',code=>{if(!settled)void finish(new Error(`The audio worker stopped before completing (${code}).`));});
 });
}
