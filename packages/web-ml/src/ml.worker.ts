import {capabilities,chooseModel,estimateRtf,LOCAL_RTF} from './device';
import {StreamTranscription} from './stream';
import {isCached,loadWhisper,type LoadedWhisper} from './whisper';
import type {Override,Reply,Request} from './protocol';
import type {CapabilityReport,DecodeWindow,ModelChoice,ProbeResult,Progress} from './types';

/** The ML worker: one Whisper model at a time, loaded on first use, decoding one window at a time (the GPU runs one
 * session at once). Speech never leaves the worker except as words. */
const scope=self as unknown as {postMessage(message:Reply):void;addEventListener(type:'message',listener:(event:MessageEvent<Request>)=>void):void};
const post=(message:Reply)=>scope.postMessage(message);
let wasmPaths:string|undefined;
let model:{key:string;loading:Promise<LoadedWhisper>;listeners:Set<(p:Progress)=>void>;loadMs:number}|undefined;
let queue:Promise<unknown>=Promise.resolve();
// A transcription's audio may arrive while its model is still downloading: messages wait on the stream in order.
const streams=new Map<number,Promise<StreamTranscription>>();

const keyOf=(c:ModelChoice)=>`${c.repo}|${c.device}|${c.encoder}|${c.decoder}`;
async function report(override?:Override):Promise<CapabilityReport>{const caps=await capabilities(),choice=chooseModel(caps,override);return{capabilities:caps,choice,cached:await isCached(choice)};}
async function load(choice:ModelChoice,onProgress:(p:Progress)=>void){
 if(model?.key!==keyOf(choice)){
  const previous=model,listeners=new Set<(p:Progress)=>void>(),at=performance.now();
  const entry:NonNullable<typeof model>={key:keyOf(choice),listeners,loadMs:0,loading:Promise.resolve(undefined!)};
  entry.loading=(async()=>{
   if(previous)await previous.loading.then(m=>m.dispose(),()=>{});
   const whisper=await loadWhisper(choice,p=>{for(const l of listeners)l(p);},{wasmPaths});entry.loadMs=Math.round(performance.now()-at);return whisper;
  })();
  model=entry;entry.loading.catch(()=>{if(model===entry)model=undefined;});
 }
 const current=model!;current.listeners.add(onProgress);
 try{return{whisper:await current.loading,loadMs:current.loadMs};}finally{current.listeners.delete(onProgress);}
}
const serial=(whisper:LoadedWhisper):DecodeWindow=>(samples,options)=>{const run=queue.then(()=>whisper.decode(samples,options));queue=run.catch(()=>{});return run;};

async function probe(id:number,override?:Override,sample?:Float32Array):Promise<ProbeResult>{
 const base=await report(override),{whisper,loadMs}=await load(base.choice,progress=>post({type:'progress',id,progress}));
 const {encoderMs,tokenMs}=await whisper.benchmark(),rtf=estimateRtf(encoderMs,tokenMs);
 let measuredRtf:number|undefined;
 if(sample?.length){const stream=new StreamTranscription(serial(whisper));stream.push(sample);measuredRtf=(await stream.end()).rtf;}
 const effective=measuredRtf??rtf,verdict=effective<=LOCAL_RTF?'local':'cloud',pace=`${(1/Math.max(effective,1e-3)).toFixed(1)}x real time`;
 return{...base,cached:true,loadMs,encoderMs:Math.round(encoderMs),tokenMs:Math.round(tokenMs*10)/10,rtf:Math.round(rtf*1000)/1000,...(measuredRtf!==undefined?{measuredRtf}:{}),verdict,
  reason:`Whisper ${base.choice.size} on ${base.choice.device} runs about ${pace}`+(verdict==='local'?'.':'; the cloud is faster on this device.')};
}

async function handle(request:Request){
 const {id}=request;
 switch(request.type){
  case'configure':wasmPaths=request.wasmPaths;return null;
  case'capabilities':return report(request.override);
  case'load':{const {choice}=await report(request.override),{whisper,loadMs}=await load(choice,progress=>post({type:'progress',id,progress}));return{...whisper.choice,loadMs};}
  case'probe':return probe(id,request.override,request.sample);
  case'start':{
   const started=(async()=>{
    const {choice}=await report(request.override),{whisper}=await load(choice,progress=>post({type:'progress',id,progress}));
    const stream:StreamTranscription=new StreamTranscription(serial(whisper),{...request.options,onWords:words=>post({type:'words',id,words}),
     onProgress:seconds=>{post({type:'progress',id,progress:{stage:'transcribe',seconds,durationSec:request.options.durationSec}});post({type:'buffer',id,received:stream.received,buffered:stream.buffered});}});
    return stream;
   })();
   streams.set(id,started);started.catch(()=>{});await started;return undefined;
  }
  case'audio':{const stream=await streams.get(id);if(!stream)throw new Error('No transcription is running for this audio.');stream.push(request.pcm);post({type:'buffer',id,received:stream.received,buffered:stream.buffered});return undefined;}
  case'end':{
   const pending=streams.get(id);if(!pending)throw new Error('No transcription is running.');
   try{const stream=await pending,result=await stream.end(),{choice}=await model!.loading;return{...result,model:`whisper-${choice.size}`,device:choice.device};}finally{streams.delete(id);}
  }
  case'cancel':{const pending=streams.get(id);streams.delete(id);pending?.then(s=>s.cancel(),()=>{});return undefined;}
 }
}

scope.addEventListener('message',event=>{
 const request=event.data;
 handle(request).then(value=>{if(value!==undefined)post({type:'reply',id:request.id,value});},error=>{
  // A failed transcription is dropped, so its audio is freed.
  const pending=streams.get(request.id);streams.delete(request.id);pending?.then(s=>s.cancel(error),()=>{});
  post({type:'error',id:request.id,error:{name:(error as Error)?.name??'Error',message:(error as Error)?.message??String(error)}});
 });
});
