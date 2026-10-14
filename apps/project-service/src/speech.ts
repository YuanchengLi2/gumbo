import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import type {AIConnection} from '@dream/contracts';
import type {Asset,Word} from '@dream/footage';
import type {ProjectDB} from '@dream/project-db';
import {atomicArtifact} from './artifacts';
import {run} from './media';
import {speechMask,fitToSpeech,type SpeechMask} from './speech-timing';
/** Raised when word timing changes, so saved transcripts are fitted again from their saved chunks (no new transcription). */
export const SPEECH_FIT='speech-fit:v1:';

export type SpeechChunk={index:number;start:number;end:number;decodeStart:number;decodeEnd:number};
export type SpeechResult={words:{word:string;start:number;end:number}[];segments?:{start:number;end:number;avg_logprob?:number;no_speech_prob?:number;text?:string}[];language?:string;translated?:boolean};
export type RangeOptions={language?:string;translate?:boolean};
export function speechChunks(duration:number):SpeechChunk[]{
 const chunks:SpeechChunk[]=[];
 for(let start=0;start<duration;){const end=Math.min(duration,start+(start===0?30:90));chunks.push({index:chunks.length,start,end,decodeStart:Math.max(0,start-1),decodeEnd:Math.min(duration,end+1)});start=end;}
 return chunks;
}
export function cloudWords(assetId:string,chunk:SpeechChunk,result:SpeechResult,duration:number,mask?:SpeechMask):Word[]{
 const words:Word[]=[],language=typeof result.language==='string'&&result.language?result.language.toLowerCase().slice(0,32):undefined;
 // Timings are checked against the chunk's own sound first (see speech-timing.ts); the language Whisper heard is kept.
 for(const item of fitToSpeech(result.words,mask)){
  const start=Math.max(0,item.start+chunk.decodeStart),end=Math.min(duration,item.end+chunk.decodeStart),middle=(start+end)/2;
  // Each overlapping chunk owns its center range, so boundary speech appears once.
  if(!item.word.trim()||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||middle<chunk.start||middle>=chunk.end)continue;
  const segment=result.segments?.find(s=>item.start>=s.start&&item.start<s.end);
  // Groq supplies segment log probability, not a per-word confidence score.
  const confidence=segment?.avg_logprob===undefined?0:Math.max(0,Math.min(1,Math.exp(segment.avg_logprob)));
  words.push({id:`${assetId}:groq:${chunk.index}:${words.length}`,assetId,text:item.word.trim(),start,end,confidence,speaker:'unknown',pauseBefore:Math.max(0,start-(words.at(-1)?.end??start)),...(language?{language}:{})});
 }
 return words;
}

/** Independent of media collection, proxy creation, full-length WAV and waveform work. */
export class CloudSpeech {
 private active=0;private waiting:(()=>void)[]=[];
 constructor(private db:ProjectDB,private ffmpeg:string,private connection:(signal?:AbortSignal)=>Promise<AIConnection>,private publish:(type:string,payload:unknown)=>void,private fetcher:typeof fetch=fetch){}
 private async slot<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
  signal.throwIfAborted();
  if(this.active>=3)await new Promise<void>((resolve,reject)=>{const next=()=>{signal.removeEventListener('abort',abort);resolve();};const abort=()=>{this.waiting=this.waiting.filter(w=>w!==next);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});this.waiting.push(next);});
  else this.active++;
  try{signal.throwIfAborted();return await work();}finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
 async transcribe(asset:Asset,signal:AbortSignal){
  const chunks=speechChunks(asset.durationSec),dir=join(this.db.folder,'Media/Analysis',asset.id,'speech');mkdirSync(dir,{recursive:true});
  const coverageKey='speech-coverage:'+asset.id,coverage:{start:number;end:number}[]=[];
  const existing=this.db.getMeta(coverageKey);if(existing)coverage.push(...JSON.parse(existing).ranges);
  const publish=()=>{this.db.setMeta(coverageKey,JSON.stringify({provider:'groq',status:coverage.length===chunks.length?'complete':'partial',ranges:coverage.sort((a,b)=>a.start-b.start)}));this.db.job(asset.id,'transcription','running',Math.round(coverage.reduce((sum,r)=>sum+r.end-r.start,0)/asset.durationSec*100));this.publish('state',this.db.state({bounded:true}));};
  let cursor=0;
  const worker=async()=>{while(cursor<chunks.length){signal.throwIfAborted();const chunk=chunks[cursor++];
   await this.slot(signal,async()=>{
    const key=`speech-chunk:v1:${asset.id}:${chunk.start}:${chunk.end}`,saved=this.db.getMeta(key);
    let result:SpeechResult;
    if(saved)result=JSON.parse(this.db.blobs.get(saved));
    else{
     const wav=join(dir,`${chunk.index}.wav`);
     await atomicArtifact(wav,temporary=>run(this.ffmpeg,['-v','error','-y','-ss',String(chunk.decodeStart),'-i',asset.originalPath,'-t',String(chunk.decodeEnd-chunk.decodeStart),'-map','0:a:0','-vn','-ar','16000','-ac','1','-c:a','pcm_s16le','-map_metadata','-1',temporary],signal).then(()=>undefined));
     const bytes=readFileSync(wav),hash=createHash('sha256').update(bytes).digest('hex'),cache='speech-audio:v1:'+hash,cached=this.db.getMeta(cache);
     if(cached)result=JSON.parse(this.db.blobs.get(cached));
     else{result=await this.request(bytes,signal);signal.throwIfAborted();this.db.setMeta(cache,this.db.blobs.put(JSON.stringify(result)));}
     this.db.setMeta(key,this.db.blobs.put(JSON.stringify(result)));
    }
    const audio=join(dir,`${chunk.index}.wav`),mask=existsSync(audio)?speechMask(readFileSync(audio)):undefined;
    signal.throwIfAborted();const words=cloudWords(asset.id,chunk,result,asset.durationSec,mask);
    // Stable chunk IDs let completed parts become searchable immediately and survive retry.
    this.db.db.transaction(()=>{this.db.saveRecords('words',words);if(!coverage.some(r=>r.start===chunk.start))coverage.push({start:chunk.start,end:chunk.end});publish();})();
   });
  }};
  // Bound both requests and queued work; long media never starts hundreds of encoders.
  const settled=await Promise.allSettled(Array.from({length:Math.min(3,chunks.length)},worker));
  const failure=settled.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failure)throw failure.reason;
  const ordered=(this.db.db.prepare("SELECT json FROM index_records WHERE kind='words' AND json_extract(json,'$.assetId')=? ORDER BY json_extract(json,'$.start')").all(asset.id) as {json:string}[]).map(r=>JSON.parse(r.json) as Word);
  const changed=ordered.flatMap((word,i)=>{const pause=Math.max(0,word.start-(ordered[i-1]?.end??0));return word.pauseBefore===pause?[]:[{...word,pauseBefore:pause}];});if(changed.length)this.db.saveRecords('words',changed);
  await atomicArtifact(join(dir,'complete.json'),async temporary=>{writeFileSync(temporary,JSON.stringify({provider:'groq',model:'whisper-large-v3-turbo',durationSec:asset.durationSec,chunks:chunks.length}));});
  this.db.setMeta(SPEECH_FIT+asset.id,'1');this.db.job(asset.id,'transcription','complete',100);this.publish('state',this.db.state({bounded:true}));
 }
 /** A stretch of a source heard again in a language the agent names (the locals' Vietnamese in an English vlog), or
  * translated to English: lines with their source times, in 90-second pieces. Not saved as the source's transcript. */
 async range(asset:Asset,startSec:number,endSec:number,options:RangeOptions,signal:AbortSignal){
  const start=Math.max(0,startSec),end=Math.min(asset.durationSec,endSec,start+300),dir=join(this.db.folder,'Media/Analysis',asset.id,'speech-range');mkdirSync(dir,{recursive:true});
  const lines:{start:number;end:number;text:string}[]=[];let language:string|undefined;
  for(let at=start;at<end;at+=90){
   const length=Math.min(90,end-at),wav=join(dir,`${Math.round(at*1000)}-${Math.round(length*1000)}.wav`);
   await atomicArtifact(wav,temporary=>run(this.ffmpeg,['-v','error','-y','-ss',String(at),'-i',asset.originalPath,'-t',String(length),'-map','0:a:0','-vn','-ar','16000','-ac','1','-c:a','pcm_s16le','-map_metadata','-1',temporary],signal).then(()=>undefined));
   const result=await this.request(readFileSync(wav),signal,options);language??=result.language;
   if(result.segments?.some(s=>s.text))for(const s of result.segments)if(s.text&&(s.no_speech_prob??0)<.8)lines.push({start:Math.round((at+s.start)*100)/100,end:Math.round((at+s.end)*100)/100,text:s.text});
   if(!result.segments?.some(s=>s.text)&&result.words.length)lines.push({start:Math.round((at+result.words[0].start)*100)/100,end:Math.round((at+result.words.at(-1)!.end)*100)/100,text:result.words.map(w=>w.word.trim()).join(' ')});
  }
  return{assetId:asset.id,startSec:start,endSec:end,language,translated:!!options.translate,lines};
 }
 private async request(bytes:Uint8Array,signal:AbortSignal,options:RangeOptions={}):Promise<SpeechResult>{
  const query=new URLSearchParams({...(options.language?{language:options.language}:{}),...(options.translate?{task:'translate'}:{})}).toString();
  for(let attempt=0;attempt<4;attempt++){
   // A dropped connection or a server error is retried with a growing wait, so one hiccup does not fail a long transcription.
   const config=await this.connection(signal);let response:Response,result:any;
   try{response=await this.fetcher(config.url+'/transcribe'+(query?'?'+query:''),{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'audio/wav'},body:new Blob([new Uint8Array(bytes)]),signal:AbortSignal.any([signal,AbortSignal.timeout(105_000)])});result=await response.json().catch(()=>({}));}
   catch(error){signal.throwIfAborted();if(attempt<3){await wait(2000*2**attempt,undefined,{signal});continue;}throw new Error('Cloud transcription could not be reached: '+(error as Error).message);}
   if(response.status>=500&&attempt<3){await wait(2000*2**attempt,undefined,{signal});continue;}
   if(response.ok){if(!Array.isArray(result.words))throw new Error('Cloud transcription returned invalid words.');return result;}
   if((response.status===409||response.status===429)&&result.retryAfterMs&&attempt<3){await wait(Math.min(30000,Math.max(1000,result.retryAfterMs)),undefined,{signal});continue;}
   throw new Error(typeof result.error==='string'?result.error:'Cloud transcription failed. Retry to resume saved chunks.');
  }
  throw new Error('Cloud transcription is busy. Retry to resume saved chunks.');
 }
}
