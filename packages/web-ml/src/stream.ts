import {Windower,speechFraction,type AudioWindow,type Seam} from './chunking';
import {collapseRepeats,mergeSeam} from './merge';
import {languageCode,languageName} from './languages';
import {SAMPLE_RATE,type DecodeWindow,type LocalSegment,type LocalSpeechResult,type LocalWord,type TranscribeOptions,type WindowResult} from './types';

export type StreamResult=Omit<LocalSpeechResult,'model'|'device'>;
export type StreamEvents={onWords?:(words:LocalWord[])=>void;onProgress?:(seconds:number)=>void};
const round=(n:number)=>Math.round(n*1000)/1000;

/** One transcription of a PCM stream: windows are decoded one at a time as their audio arrives, joined at the seams, and
 * words are handed out once no later window can change them. Memory is the windower's buffer plus the words. */
export class StreamTranscription{
 private windower:Windower;private words:LocalWord[]=[];private emitted=0;private windows:{start:number;seam?:Seam;result:WindowResult}[]=[];
 private running?:Promise<void>;private again=false;private failure?:unknown;private controller=new AbortController();private began=performance.now();
 private language?:string;private step:number;
 constructor(private decode:DecodeWindow,private options:TranscribeOptions&StreamEvents={},signal?:AbortSignal){
  const windowSec=options.windowSec??30,overlapSec=options.overlapSec??4;this.windower=new Windower(windowSec,overlapSec);this.step=windowSec-overlapSec;
  if(options.language!==undefined){this.language=languageCode(options.language);if(!this.language)throw new Error(`Whisper does not know the language "${options.language}".`);}
  signal?.addEventListener('abort',()=>this.cancel(signal.reason),{once:true});if(signal?.aborted)this.cancel(signal.reason);
 }
 get buffered(){return this.windower.buffered;}
 get received(){return this.windower.received;}
 push(pcm:Float32Array){this.check();this.windower.push(pcm);this.pump();}
 cancel(reason:unknown=new DOMException('Transcription cancelled.','AbortError')){if(!this.controller.signal.aborted)this.controller.abort(reason);}
 async end():Promise<StreamResult>{
  this.check();this.windower.end();this.pump();
  while(this.running)await this.running;
  this.check();this.settle(Infinity);
  return this.result();
 }
 private check(){this.controller.signal.throwIfAborted();if(this.failure)throw this.failure;}
 private pump(){
  if(this.running){this.again=true;return;}
  this.running=(async()=>{for(let window=this.windower.next();window;window=this.windower.next())await this.process(window);})()
   .catch(error=>{this.failure??=error;this.controller.abort(error);})
   .finally(()=>{this.running=undefined;if(this.again&&!this.failure){this.again=false;this.pump();}});
 }
 private async process(window:AudioWindow){
  const signal=this.controller.signal,length=window.samples.length/SAMPLE_RATE;signal.throwIfAborted();
  const quiet=speechFraction(window.samples)<.01,language=this.language??this.windows.at(-1)?.result.language??'en';
  const result:WindowResult=quiet?{words:[],language,languageProbability:0,noSpeechProb:1,avgLogprob:0,tokens:0,truncated:false,skipped:'silent'}:await this.decode(window.samples,{language:this.language,task:this.options.task??'transcribe',signal});
  signal.throwIfAborted();
  // Whisper's own silence rule: a likely no-speech window whose text the model was unsure of is dropped.
  if(!result.skipped&&result.noSpeechProb>.6&&result.avgLogprob<-1)result.skipped='no-speech';
  const name=languageName(result.language);
  const words=result.skipped?[]:collapseRepeats(result.words).flatMap(w=>{const start=round(window.start+Math.min(Math.max(w.start,0),length)),end=round(window.start+Math.min(Math.max(w.end,0),length));return w.word.trim()&&end>=start?[{word:w.word.trim(),start,end,probability:w.probability,language:name}]:[];});
  const settled=this.words.slice(0,this.emitted),open=this.words.slice(this.emitted);
  this.words=[...settled,...(window.seam?mergeSeam(open,words,window.seam):words)];
  this.windows.push({start:window.start,seam:window.seam,result});
  // The next window's merge only looks at words ending after its start minus half a second.
  this.settle(window.start+this.step-.5);
  this.options.onProgress?.(Math.min(this.windower.seconds,window.start+length));
 }
 private settle(before:number){
  let end=this.emitted;while(end<this.words.length&&this.words[end].end<=before)end++;
  if(end>this.emitted){const fresh=this.words.slice(this.emitted,end);this.emitted=end;this.options.onWords?.(fresh);}
 }
 private result():StreamResult{
  const durationSec=this.windower.seconds,elapsedMs=performance.now()-this.began;
  // Segments tile the audio, one per window, split at the seams' cuts, so each word lies in exactly one.
  const segments:LocalSegment[]=this.windows.map((w,i)=>{const start=i?w.seam!.cut:0,end=this.windows[i+1]?.seam?.cut??durationSec;
   return{start:round(start),end:round(end),avg_logprob:w.result.avgLogprob,no_speech_prob:w.result.noSpeechProb,language:languageName(w.result.language),text:this.words.filter(x=>(x.start+x.end)/2>=start&&(x.start+x.end)/2<end).map(x=>x.word).join(' ')};});
  const counts=new Map<string,number>();for(const w of this.words)counts.set(w.language,(counts.get(w.language)??0)+1);
  const language=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??languageName(this.language??this.windows[0]?.result.language??'en');
  return{words:this.words,segments,language,languageCode:languageCode(language)??'en',...(this.options.task==='translate'?{translated:true}:{}),durationSec:round(durationSec),elapsedMs:Math.round(elapsedMs),rtf:durationSec?round(elapsedMs/1000/durationSec):0};
 }
}
