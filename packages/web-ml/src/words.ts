import type {Word} from '@dream/footage';
import type {LocalWord} from './types';

/** A local transcript as the project's stored words, the shape `cloudWords` (apps/project-service/src/speech.ts) saves:
 * source-time seconds (`offset` is where the transcribed audio starts in the source), the language name on every word,
 * and the model's own word probability as confidence where the cloud has only a segment's average. Run the result
 * through `cloudWords` instead to also fit timings to the heard speech (speech-timing.ts) exactly as cloud words are. */
export function localWords(assetId:string,words:LocalWord[],{offset=0,durationSec=Infinity}:{offset?:number;durationSec?:number}={}):Word[]{
 const out:Word[]=[];
 for(const w of words){
  // Alignment can give a short word no frame of its own; it keeps one (20 ms), since stored words need end > start.
  const start=Math.max(0,w.start+offset),end=Math.min(durationSec,Math.max(w.end,w.start+.02)+offset),text=w.word.trim();
  if(!text||!Number.isFinite(start)||!(end>start))continue;
  out.push({id:`${assetId}:whisper:${out.length}`,assetId,text,start,end,confidence:Math.max(0,Math.min(1,w.probability)),speaker:'unknown',pauseBefore:Math.max(0,start-(out.at(-1)?.end??0)),...(w.language?{language:w.language.toLowerCase().slice(0,32)}:{})});
 }
 return out;
}
