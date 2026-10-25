import {LocalWhisper,wavToPcm,languageCode,SAMPLE_RATE} from '@dream/web-ml';
import {CloudSpeech as Speech,type RangeOptions,type SpeechResult} from '../../../project-service/src/speech';
export * from '../../../project-service/src/speech';

/** Speech on the web. Signed in, the gateway hears it (Whisper large-v3 turbo): a whole video in seconds, better words
 * than a browser can run, about 4 cents for an hour of audio. In the browser even a fast computer took minutes, after a
 * 100–250 MB model download. Signed out, or when the cloud can't be reached or refuses, Whisper in this browser
 * (packages/web-ml) hears it instead, so captions still work with no account; that audio never leaves the browser.
 * The desktop's CloudSpeech (speech.ts) stays as it is (its chunks, their cache, word timing and progress); only where
 * a chunk is heard changes. */
let whisper:LocalWhisper|undefined;
// ONNX Runtime's WebAssembly comes from this site (vite.config.ts serves it), not a CDN.
const local=()=>whisper??=new LocalWhisper(undefined,{wasmPaths:`${import.meta.env.BASE_URL}ort/`});
let told=false;
export class CloudSpeech extends Speech{
 protected override async request(bytes:Uint8Array,signal:AbortSignal,options:RangeOptions={}):Promise<SpeechResult>{
  try{return await super.request(bytes,signal,options);}
  catch(error){
   if(signal.aborted)throw error;
   if(!told){told=true;console.info(`[speech] heard on this computer: ${(error as Error).message}`);}
   // Kept with the source and sent in the edit log, so a slow transcription says why the cloud didn't hear it.
   this.heardElsewhere(options.assetId,error as Error);
   const pcm=wavToPcm(bytes);
   // base: about half the time of small, which matters more here than its slightly better words.
   return local().transcribe(pcm,{signal,override:{size:'base'},durationSec:pcm.length/SAMPLE_RATE,language:languageCode(options.language),task:options.translate?'translate':'transcribe'});
  }
 }
}
