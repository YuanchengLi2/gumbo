/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import {analyseSound,loadSoundModels,type LoadedSoundModels,type SoundModelFile} from '@dream/sound';

/** Sound analysis on the web (packages/sound), in a worker of its own so the project worker (and the agent in it) never
 * waits on it: about three minutes an hour of footage. The project worker asks for an analysis and hands over the samples as this worker pulls them, ten seconds
 * at a time, so an hour of footage never sits in memory. The models come from Hugging Face once, checked by hash, and
 * stay in the browser's Cache API; ONNX Runtime's WebAssembly is the copy this site serves for local Whisper. */
type Request={type:'analyse';id:string;durationSec:number;wasmPaths:string}|{type:'chunk';id:string;data:Float32Array}|{type:'end';id:string}|{type:'cancel';id:string};
const post=(message:unknown,transfer:Transferable[]=[])=>(self as unknown as Worker).postMessage(message,transfer);

async function modelBytes(file:SoundModelFile){
 const cache=await caches.open('gumbo-sound-models-v1'),hit=await cache.match(file.url);
 if(hit)return new Uint8Array(await hit.arrayBuffer());
 const response=await fetch(file.url);if(!response.ok)throw new Error(`The sound model could not be downloaded (${response.status}).`);
 const bytes=new Uint8Array(await response.arrayBuffer()),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==file.sha256)throw new Error('The downloaded sound model did not match its checksum.');
 await cache.put(file.url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));
 return bytes;
}
let models:Promise<LoadedSoundModels>|undefined;
const runs=new Map<string,{controller:AbortController;waiting?:(chunk:Float32Array|undefined)=>void}>();

/** The samples of one analysis, pulled from the project worker as they are needed. */
async function* pull(id:string){
 for(;;){
  const run=runs.get(id);if(!run)return;
  const chunk=await new Promise<Float32Array|undefined>(resolve=>{run.waiting=resolve;post({type:'pull',id});});
  if(!chunk)return;yield chunk;
 }
}
self.onmessage=async({data}:MessageEvent<Request>)=>{
 if(data.type==='chunk'||data.type==='end'){const run=runs.get(data.id),waiting=run?.waiting;if(run)run.waiting=undefined;waiting?.(data.type==='chunk'?data.data:undefined);return;}
 if(data.type==='cancel'){const run=runs.get(data.id);run?.controller.abort();run?.waiting?.(undefined);return;}
 const controller=new AbortController();runs.set(data.id,{controller});
 try{
  // All but two cores, at most eight: playback and the editor keep the rest.
  ort.env.wasm.numThreads=Math.min(8,Math.max(1,(navigator.hardwareConcurrency||4)-2));ort.env.wasm.wasmPaths=data.wasmPaths;
  // The graphics card when the browser offers one (about twice as fast), else WebAssembly.
  models??=loadSoundModels(ort as any,modelBytes,{executionProviders:['wasm']}).catch(error=>{models=undefined;throw error;});
  post({type:'done',id:data.id,result:await analyseSound(pull(data.id),data.durationSec,await models,controller.signal)});
 }catch(error){post({type:'failed',id:data.id,error:(error as Error).message||String(error)});}
 finally{runs.delete(data.id);}
};
