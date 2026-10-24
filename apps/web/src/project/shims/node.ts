import {Buffer} from 'buffer';
import {gzipSync as gzip,gunzipSync as gunzip,deflateSync as deflate,inflateSync as inflate} from 'fflate';
import {esbuild} from './esbuild';
/** The small Node built-ins the project service touches, for the browser. Each export names its module; vite.config.ts
 * points node:os, node:zlib, node:util, node:timers/promises, node:stream, node:stream/promises, node:readline,
 * node:module, node:vm, node:worker_threads, node:dns/promises and node:net here. What only runs with the agent
 * (workers, scripts) says plainly it is not in the browser yet. */
const bytes=(data:unknown)=>typeof data==='string'?Buffer.from(data):data as Uint8Array;
const asBuffer=(data:Uint8Array)=>Buffer.from(data.buffer,data.byteOffset,data.byteLength);

// node:os
export const homedir=()=>'/home',tmpdir=()=>'/tmp',totalmem=()=>((navigator as any).deviceMemory??8)*1024**3,freemem=()=>totalmem()/2,platform=()=>'linux',cpus=()=>Array.from({length:navigator.hardwareConcurrency||4},()=>({model:'browser',speed:0})),EOL='\n',setPriority=()=>undefined,constants={priority:{PRIORITY_NORMAL:0,PRIORITY_BELOW_NORMAL:10}};
// node:zlib
export const gzipSync=(data:unknown)=>asBuffer(gzip(bytes(data))),gunzipSync=(data:unknown)=>asBuffer(gunzip(bytes(data))),deflateSync=(data:unknown)=>asBuffer(deflate(bytes(data))),inflateSync=(data:unknown)=>asBuffer(inflate(bytes(data)));
export const gzipAsync=(data:unknown,callback:(error:Error|null,result?:Buffer)=>void)=>{try{callback(null,gzipSync(data));}catch(error){callback(error as Error);}};
// node:util
export function isDeepStrictEqual(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true;if(typeof a!=='object'||typeof b!=='object'||!a||!b||Object.getPrototypeOf(a)!==Object.getPrototypeOf(b))return false;
 if(Array.isArray(a))return a.length===(b as unknown[]).length&&a.every((v,i)=>isDeepStrictEqual(v,(b as unknown[])[i]));
 const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&isDeepStrictEqual((a as any)[k],(b as any)[k]));
}
export const promisify=(fn:Function)=>(...args:unknown[])=>new Promise((resolve,reject)=>fn(...args,(error:Error|null,value:unknown)=>error?reject(error):resolve(value)));
export const inspect=(value:unknown)=>{try{return JSON.stringify(value);}catch{return String(value);}};
// node:timers/promises
export const setTimeout=(ms=0,value?:unknown,options?:{signal?:AbortSignal})=>new Promise((resolve,reject)=>{const signal=options?.signal;if(signal?.aborted){reject(signal.reason??new DOMException('Aborted','AbortError'));return;}const timer=globalThis.setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve(value);},ms);const abort=()=>{globalThis.clearTimeout(timer);reject(signal!.reason??new DOMException('Aborted','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});
export const setImmediate=(value?:unknown)=>new Promise(resolve=>globalThis.setTimeout(()=>resolve(value),0));
// node:stream
export class Transform{
 constructor(private options:{transform:(chunk:any,encoding:string,callback:(error?:Error|null,data?:any)=>void)=>void;flush?:(callback:(error?:Error|null,data?:any)=>void)=>void}){}
 async*pipe(source:AsyncIterable<any>){for await(const chunk of source){const out=await new Promise<any>((resolve,reject)=>this.options.transform(chunk,'buffer',(error,data)=>error?reject(error):resolve(data)));if(out!==undefined&&out!==null)yield out;}if(this.options.flush){const tail=await new Promise<any>((resolve,reject)=>this.options.flush!((error,data)=>error?reject(error):resolve(data)));if(tail!==undefined&&tail!==null)yield tail;}}
}
export class Readable{static from(iterable:Iterable<any>|AsyncIterable<any>){return iterable;}}
// node:stream/promises: a source (async iterable), transforms, and a sink with write/end, as the project service chains them.
export async function pipeline(...stages:any[]){
 const options=stages.at(-1)&&!stages.at(-1).write&&!(Symbol.asyncIterator in stages.at(-1))&&!(stages.at(-1) instanceof Transform)?stages.pop():undefined;const signal:AbortSignal|undefined=options?.signal;
 let source:AsyncIterable<any>=stages.shift();const sink=stages.pop();
 for(const stage of stages)source=stage instanceof Transform?stage.pipe(source):stage(source);
 for await(const chunk of source){signal?.throwIfAborted();await new Promise<void>((resolve,reject)=>{const ok=sink.write(chunk,undefined,(error?:Error)=>error?reject(error):resolve());if(ok===false&&!sink.write.length)resolve();});}
 await new Promise<void>(resolve=>sink.end(resolve));
}
// node:readline: lines from a stream (for await … of createInterface({input})).
export function createInterface({input}:{input:AsyncIterable<Uint8Array|string>}){
 const decoder=new TextDecoder();let closed=false;
 return{async*[Symbol.asyncIterator](){let rest='';for await(const chunk of input){if(closed)return;rest+=typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true});const lines=rest.split(/\r?\n/);rest=lines.pop()!;for(const line of lines)yield line;}if(rest&&!closed)yield rest;},close(){closed=true;(input as any).destroy?.();},on(){return this;}};
}
// What has no browser version says so. Worker threads have their web versions where they are used (music and sound:
// web-procedural-client.ts); commands run in the browser sandbox (child-process.ts).
const notYet=(what:string)=>{throw new Error(`${what} is not available in the browser yet.`);};
export class Worker{constructor(){notYet('A background worker');}}
export const parentPort=null,workerData=undefined,isMainThread=true;
// vm.Script compiles without running, which scene-source.ts uses to check a scene's JavaScript: a Function made from
// the code parses it the same way and is never called.
export class Script{constructor(code:string){new Function(code);}}
/** require() for what the project service loads that way: esbuild, for compiling scenes (shims/esbuild.ts). */
export const createRequire=()=>(id:string)=>id==='esbuild'?esbuild:notYet(`Loading ${id}`);
export const lookup=async()=>notYet('Looking up addresses');
export const isIP=(value:string)=>/^\d{1,3}(\.\d{1,3}){3}$/.test(value)?4:/^[0-9a-f:]+$/i.test(value)&&value.includes(':')?6:0;
export default {homedir,tmpdir,totalmem,platform,gzipSync,gunzipSync,isDeepStrictEqual,promisify,setTimeout,Transform,pipeline,createInterface,Worker,Script,createRequire,lookup,isIP};
