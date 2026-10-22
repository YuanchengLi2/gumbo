import type {Override,Reply,Request} from './protocol';
import {SAMPLE_RATE,type CapabilityReport,type LocalSpeechResult,type LocalWord,type ModelChoice,type ProbeResult,type Progress,type TranscribeOptions} from './types';

type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;onProgress?:(p:Progress)=>void;onWords?:(w:LocalWord[])=>void;onBuffer?:(received:number,buffered:number)=>void};
type Distributive<T>=T extends unknown?Omit<T,'id'>:never;
const remoteError=(e:{name:string;message:string})=>Object.assign(e.name==='AbortError'?new DOMException(e.message,'AbortError'):new Error(e.message),{name:e.name}) as Error;

export type StreamOptions=TranscribeOptions&{override?:Override;signal?:AbortSignal;onWords?:(words:LocalWord[])=>void;onProgress?:(p:Progress)=>void;
 /** Seconds of audio allowed in flight or waiting in the worker before `push` waits. */highWaterSec?:number};

/** A transcription fed as audio arrives (e.g. decoded a few seconds at a time from a long file). Await each `push`: it
 * returns once the worker has room, which keeps memory bounded however long the audio is. */
export class TranscriptionStream{
 private sent=0;private received=0;private buffered=0;private waiters:(()=>void)[]=[];private failed?:Error;
 readonly result:Promise<LocalSpeechResult>;
 constructor(private client:LocalWhisper,private id:number,private highWater:number,result:Promise<LocalSpeechResult>){
  this.result=result.catch(error=>{this.failed=error;this.wake();throw error;});this.result.catch(()=>{});
 }
 /** @internal */
 buffer(received:number,buffered:number){this.received=received;this.buffered=buffered;this.wake();}
 private wake(){const waiters=this.waiters;this.waiters=[];for(const w of waiters)w();}
 private get inFlight(){return this.sent-this.received+this.buffered;}
 async push(pcm:Float32Array){
  if(this.failed)throw this.failed;
  // Copied, then transferred: the caller keeps its array and the worker gets its own without a second copy.
  for(let at=0;at<pcm.length;at+=SAMPLE_RATE*10){
   const part=pcm.slice(at,at+SAMPLE_RATE*10);this.sent+=part.length;this.client.send({type:'audio',id:this.id,pcm:part},[part.buffer]);
   while(this.inFlight>this.highWater&&!this.failed)await new Promise<void>(resolve=>this.waiters.push(resolve));
   if(this.failed)throw this.failed;
  }
 }
 /** No more audio: resolves with the whole transcript once the last window is decoded. */
 end(){if(!this.failed)this.client.send({type:'end',id:this.id});return this.result;}
 cancel(){this.client.cancel(this.id);}
}

/** The main thread's handle on the ML worker. Pass the worker when bundling yourself; by default it is created with
 * Vite's `new URL(…, import.meta.url)` worker pattern. */
export class LocalWhisper{
 private worker:Worker;private next=1;private pending=new Map<number,Pending>();
 constructor(worker?:Worker,options:{wasmPaths?:string}={}){
  this.worker=worker??new Worker(new URL('./ml.worker.ts',import.meta.url),{type:'module'});
  this.worker.addEventListener('message',(event:MessageEvent<Reply>)=>this.receive(event.data));
  this.worker.addEventListener('error',event=>this.failAll(new Error(event.message||'The ML worker stopped.')));
  if(options.wasmPaths)void this.request({type:'configure',wasmPaths:options.wasmPaths});
 }
 /** @internal */
 send(message:Request,transfer:Transferable[]=[]){this.worker.postMessage(message,transfer);}
 private request<T>(message:Distributive<Request>,handlers:Omit<Pending,'resolve'|'reject'>={},transfer:Transferable[]=[]):Promise<T>{
  const id=this.next++;
  return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve,reject,...handlers});this.send({...message,id} as Request,transfer);});
 }
 private receive(reply:Reply){
  const pending=this.pending.get(reply.id);if(!pending)return;
  switch(reply.type){
   case'reply':this.pending.delete(reply.id);pending.resolve(reply.value);break;
   case'error':this.pending.delete(reply.id);pending.reject(remoteError(reply.error));break;
   case'progress':pending.onProgress?.(reply.progress);break;
   case'words':pending.onWords?.(reply.words);break;
   case'buffer':pending.onBuffer?.(reply.received,reply.buffered);break;
  }
 }
 private failAll(error:Error){for(const p of this.pending.values())p.reject(error);this.pending.clear();}

 /** WebGPU, the model this device would run, and whether it is downloaded already. Loads nothing. */
 capabilities(override?:Override){return this.request<CapabilityReport>({type:'capabilities',override});}
 /** Loads the model (downloading it once) and times it; `verdict` says whether to offer the cloud instead. A `sample`
 * (e.g. the first 30 s of the user's audio) adds a real measured speed. */
 probe(options:{override?:Override;sample?:Float32Array;onProgress?:(p:Progress)=>void}={}){
  const sample=options.sample?.slice();
  return this.request<ProbeResult>({type:'probe',override:options.override,sample},{onProgress:options.onProgress},sample?[sample.buffer]:[]);
 }
 load(options:{override?:Override;onProgress?:(p:Progress)=>void}={}){return this.request<ModelChoice&{loadMs:number}>({type:'load',override:options.override},{onProgress:options.onProgress});}

 stream(options:StreamOptions={}):TranscriptionStream{
  const id=this.next++,{override,signal,onWords,onProgress,highWaterSec=60,...transcribe}=options;
  let stream!:TranscriptionStream;
  const result=new Promise<LocalSpeechResult>((resolve,reject)=>{
   this.pending.set(id,{resolve,reject,onWords,onProgress,onBuffer:(received,buffered)=>stream.buffer(received,buffered)});
   if(signal?.aborted){this.pending.delete(id);return reject(signal.reason);}
   signal?.addEventListener('abort',()=>this.cancel(id,signal.reason),{once:true});
   this.send({type:'start',id,override,options:transcribe});
  });
  stream=new TranscriptionStream(this,id,highWaterSec*SAMPLE_RATE,result);
  return stream;
 }
 /** Transcribes 16 kHz mono PCM: one array, or chunks from an async source (a decoder, a ReadableStream). */
 async transcribe(audio:Float32Array|AsyncIterable<Float32Array>,options:StreamOptions={}):Promise<LocalSpeechResult>{
  const stream=this.stream(options);
  try{if(audio instanceof Float32Array)await stream.push(audio);else for await(const chunk of audio)await stream.push(chunk);}
  catch(error){stream.cancel();await stream.result.catch(()=>{});throw error;}
  return stream.end();
 }
 /** @internal */
 cancel(id:number,reason:unknown=new DOMException('Transcription cancelled.','AbortError')){
  const pending=this.pending.get(id);this.pending.delete(id);this.send({type:'cancel',id});pending?.reject(reason as Error);
 }
 dispose(){this.worker.terminate();this.failAll(new DOMException('The ML worker was closed.','AbortError'));}
}
