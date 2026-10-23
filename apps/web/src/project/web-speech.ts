import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {LocalWhisper,wavToPcm,languageCode,SAMPLE_RATE,type ProbeResult} from '@dream/web-ml';
import {CloudSpeech as Speech,type RangeOptions,type SpeechResult} from '../../../project-service/src/speech';
export * from '../../../project-service/src/speech';

/** Speech on the web: heard by Whisper in this browser (packages/web-ml) when this computer keeps up with it, by the
 * gateway's transcription otherwise. The desktop's CloudSpeech (speech.ts) stays as it is (its chunks, their cache,
 * word timing and progress); only where a chunk is heard changes. Whether this computer keeps up is measured once, on
 * the first chunk, and remembered in /profile; a chunk that fails locally is heard in the cloud. The audio of a chunk
 * heard locally never leaves the browser, and needs no account. */
const remembered='/profile/speech-local.json';
let whisper:LocalWhisper|undefined,verdict:Promise<'local'|'cloud'>|undefined;
// ONNX Runtime's WebAssembly comes from this site (vite.config.ts serves it), not a CDN.
const local=()=>whisper??=new LocalWhisper(undefined,{wasmPaths:`${import.meta.env.BASE_URL}ort/`});
function where(sample:Float32Array):Promise<'local'|'cloud'>{
 return verdict??=(async()=>{
  try{const saved=existsSync(remembered)?JSON.parse(readFileSync(remembered,'utf8')) as ProbeResult&{measuredAt:string}:undefined;if(saved?.verdict)return saved.verdict;}catch{}
  try{
   const probe=await local().probe({sample:sample.slice(0,30*SAMPLE_RATE)});
   writeFileSync(remembered,JSON.stringify({...probe,measuredAt:new Date().toISOString()}));
   console.info(`[speech] ${probe.verdict==='local'?'heard on this computer':'heard in the cloud'}: ${probe.reason}`);
   return probe.verdict;
  }catch(error){
   // Not remembered: the model may download next time (offline, a blocked download).
   console.warn('[speech] local transcription is unavailable; using the cloud',error);verdict=undefined;return'cloud';
  }
 })();
}
export class CloudSpeech extends Speech{
 protected override async request(bytes:Uint8Array,signal:AbortSignal,options:RangeOptions={}):Promise<SpeechResult>{
  const pcm=wavToPcm(bytes);
  if(await where(pcm)==='local')try{
   return await local().transcribe(pcm,{signal,durationSec:pcm.length/SAMPLE_RATE,language:languageCode(options.language),task:options.translate?'translate':'transcribe'});
  }catch(error){if(signal.aborted)throw error;console.warn('[speech] a chunk failed on this computer; hearing it in the cloud',error);}
  return super.request(bytes,signal,options);
 }
}
