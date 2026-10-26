/** Sounds and voices, on this computer: YAMNet (what kind of sound: laughter, applause, music…) and CAM++ (a voice's
 * fingerprint, to tell speakers apart), from @dream/sound, on ONNX Runtime's WebAssembly. Both models download once on
 * first listen, are checked by hash and kept in the browser's cache. */
import * as ort from 'onnxruntime-web';
import {loadSoundModels,soundModelFiles,type LoadedSoundModels,type SoundModelFile} from '@dream/sound';
import {fbank,subtractMean} from '../../../../../packages/sound/src/fbank';
import {groupClasses,eventThreshold,eventGroups} from '../../../../../packages/sound/src/classes';
ort.env.wasm.wasmPaths=new URL('/ort/',self.location.href).href;
ort.env.wasm.numThreads=(self as any).crossOriginIsolated?2:1;
let models:Promise<LoadedSoundModels>|undefined;
async function load(file:SoundModelFile):Promise<Uint8Array>{
 const cache=await caches.open('gumbo-models'),hit=await cache.match(file.url);
 const bytes=new Uint8Array(await (hit??await fetch(file.url)).arrayBuffer());
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==file.sha256)throw new Error(`${file.filename} does not match its hash.`);
 if(!hit)await cache.put(file.url,new Response(bytes));
 return bytes;
}
const ready=()=>models??=loadSoundModels(ort as any,load,{executionProviders:['wasm']});
self.onmessage=async(event:MessageEvent<{id:number;type:'voice'|'sounds';pcm:Float32Array}>)=>{
 const {id,type,pcm}=event.data;
 try{
  const m=await ready();
  if(type==='voice'){
   // One voice fingerprint for a stretch of speech (up to six seconds of it).
   const clip=pcm.slice(0,16000*6),{frames,data}=fbank(clip,80);subtractMean(data,frames,80);
   const [vector]=await m.embed(data,frames,1);(self as any).postMessage({id,vector:Array.from(vector)});return;
  }
  // The sounds in a block: each event group whose score passes its threshold, with when in the block it peaked.
  const {scores,frames}=await m.classify(pcm),found:{label:string;at:number;score:number}[]=[];
  for(const group of eventGroups){
   let best=0,at=0;for(let f=0;f<frames;f++){let s=0;for(const c of groupClasses[group])s=Math.max(s,scores[f*521+c]);if(s>best){best=s;at=f*0.48;}}
   if(best>=(eventThreshold[group]??0.3))found.push({label:group,at,score:best});
  }
  let music=0;for(let f=0;f<frames;f++)for(const c of groupClasses.music)music=Math.max(music,scores[f*521+c]);
  if(music>0.5)found.push({label:'music',at:0,score:music});
  (self as any).postMessage({id,sounds:found});
 }catch(error){(self as any).postMessage({id,error:String((error as Error)?.message??error)});}
};
export {soundModelFiles};
