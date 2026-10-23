import {CommandError,type Command,type CommandContext,type Host} from '../shell/types';
import {EmptyInput} from '../shell/io';
import {mountSandbox} from './emscripten-fs';
import {mkdirp,tryStat} from '../fs/util';
import {join} from '../path';
import type {SandboxAssets} from '../sandbox';

export const FFMPEG_CORE_VERSION='0.12.10';
const cdn=(threads:boolean)=>`https://cdn.jsdelivr.net/npm/@ffmpeg/core${threads?'-mt':''}@${FFMPEG_CORE_VERSION}/dist/esm/`;
type Core={exec(...args:string[]):number;ffprobe(...args:string[]):number;ret:number;reset():void;setTimeout(ms:number):void;setLogger(f:(log:{type:string;message:string})=>void):void;FS:any};
let loading:Promise<{core:Core;threads:boolean}>|undefined,queue:Promise<unknown>=Promise.resolve(),log:((type:string,message:string)=>void)|undefined;
/** Threads need SharedArrayBuffer, which a page has only when it is cross-origin isolated (COOP/COEP headers). */
export const threadsAvailable=()=>typeof SharedArrayBuffer!=='undefined'&&(globalThis as {crossOriginIsolated?:boolean}).crossOriginIsolated===true;
const here=()=>(globalThis as {location?:{href:string}}).location?.href??'http://localhost/';
/** A worker can only be started from its own origin, so core files from a CDN become blob: URLs first. */
async function sameOrigin(url:string,type:string){if(new URL(url).origin===new URL(here()).origin)return url;const response=await fetch(url);if(!response.ok)throw new Error(`could not fetch ${url}: ${response.status}`);return URL.createObjectURL(new Blob([await response.arrayBuffer()],{type}));}
/** Loads ffmpeg.wasm's core once per worker (about 32 MB of wasm): the threaded build when the page is isolated. */
export function loadFFmpeg(host:Host){
 loading??=(async()=>{
  const assets=host.assets as SandboxAssets|undefined,threads=threadsAvailable()&&assets?.ffmpegMt!=='';
  const base=new URL((threads?assets?.ffmpegMt:assets?.ffmpeg)??cdn(threads),here()).href;
  const coreURL=await sameOrigin(new URL('ffmpeg-core.js',base).href,'text/javascript'),wasmURL=new URL('ffmpeg-core.wasm',base).href;
  const workerURL=threads?await sameOrigin(new URL('ffmpeg-core.worker.js',base).href,'text/javascript'):'';
  const {default:create}=await import(/* @vite-ignore */ coreURL);
  // The core finds its wasm and thread worker through this fragment (as @ffmpeg/ffmpeg passes them).
  const core:Core=await create({mainScriptUrlOrBlob:`${coreURL}#${btoa(JSON.stringify({wasmURL,workerURL}))}`});
  core.setLogger(({type,message})=>log?.(type,message));
  return{core,threads};
 })();
 loading.catch(()=>{loading=undefined;});
 return loading;
}
function exclusive<T>(f:()=>Promise<T>):Promise<T>{const run=queue.then(f,f);queue=run.catch(()=>{});return run;}
const PIPES=new Set(['-','pipe:','pipe:0','pipe:1']);
/** Options that print information through ffmpeg's help log callback. The core keeps that callback after the run, and
 * every later run would then print all its debug logs whatever -v says, so the core is replaced after one of these. */
const INFO=/^-(version|buildconf|license|h|\?|help|-help|formats|muxers|demuxers|devices|codecs|decoders|encoders|bsfs|protocols|filters|pix_fmts|layouts|sample_fmts|dispositions|colors|hwaccels|sources|sinks|L)$/;
function retire(core:Core){loading=undefined;try{(core as {PThread?:{terminateAllThreads():void}}).PThread?.terminateAllThreads();}catch{}}
/** ffmpeg's threads come from a pool of loaded workers. A thread past the pool needs a new worker to load, which needs
 * this worker's event loop while exec blocks it: a deadlock (an H.264 decode plus x264 on 12 cores asked for ~45).
 * So the pool is topped up before each run, and the core is shown at most FFMPEG_CPUS cores while it runs. */
export const FFMPEG_CPUS=4;const SPARE_THREADS=40;
type Pool={unusedWorkers:unknown[];allocateUnusedWorker():void;loadWasmModuleToWorker(worker:unknown):Promise<unknown>};
async function topUp(core:Core){
 const pool=(core as {PThread?:Pool}).PThread;if(!pool)return;const loads:Promise<unknown>[]=[];
 while(pool.unusedWorkers.length<SPARE_THREADS){pool.allocateUnusedWorker();loads.push(pool.loadWasmModuleToWorker(pool.unusedWorkers[pool.unusedWorkers.length-1]));}
 await Promise.all(loads);
}
/** The core's exec and ffprobe drop main's return value (ffprobe returns its status instead of calling exit()), so the
 * entry points are called directly, the same way. */
function callMain(core:Core,tool:'ffmpeg'|'ffprobe',args:string[]):number|undefined{
 const c=core as unknown as {DEFAULT_ARGS:string[];DEFAULT_ARGS_FFPROBE:string[];_ffmpeg(n:number,p:number):number;_ffprobe(n:number,p:number):number;stringsToPtr(a:string[]):number};
 const all=[...(tool==='ffmpeg'?c.DEFAULT_ARGS:c.DEFAULT_ARGS_FFPROBE),...args];
 try{return tool==='ffmpeg'?c._ffmpeg(all.length,c.stringsToPtr(all)):c._ffprobe(all.length,c.stringsToPtr(all));}
 catch(error){if(!String((error as Error)?.message??error).startsWith('Aborted'))throw error;return undefined;}
}
function withFewerCores<T>(f:()=>T):T{
 const nav=(globalThis as {navigator?:{hardwareConcurrency?:number}}).navigator;if(!nav)return f();
 const cores=nav.hardwareConcurrency??FFMPEG_CPUS;
 try{Object.defineProperty(nav,'hardwareConcurrency',{configurable:true,get:()=>Math.min(cores,FFMPEG_CPUS)});}catch{return f();}
 try{return f();}finally{delete (nav as {hardwareConcurrency?:number}).hardwareConcurrency;}
}
/** ffmpeg and ffprobe on the sandbox's files. stdin and stdout ("-", pipe:) go through temporary files, since the core
 * reads and writes only files; output streams to the command's stdout when ffmpeg is done. */
async function run(ctx:CommandContext,tool:'ffmpeg'|'ffprobe'):Promise<number>{
 const {core}=await loadFFmpeg(ctx.host);
 return exclusive(async()=>{
  const FS=core.FS,workspace=ctx.host.workspace;
  mountSandbox(FS,ctx.fs,workspace);mkdirp(ctx.fs,'/tmp');mountSandbox(FS,ctx.fs,'/tmp');
  for(const folder of ctx.host.mounts??[])if(tryStat(ctx.fs,folder)?.type==='directory')mountSandbox(FS,ctx.fs,folder);
  if(!ctx.cwd.startsWith(workspace)&&!ctx.cwd.startsWith('/tmp'))mountSandbox(FS,ctx.fs,'/'+ctx.cwd.split('/')[1]);
  FS.chdir(ctx.cwd);
  const tmp=join(workspace,'.cache','tmp');mkdirp(ctx.fs,tmp);const temps:string[]=[];let stdoutFile:string|undefined;
  const args=[...ctx.args];
  for(let i=0;i<args.length;i++){
   if(!PIPES.has(args[i]))continue;
   const input=tool==='ffprobe'?!args[i-1]?.startsWith('-')||args[i-1]==='-i':args[i-1]==='-i';
   const file=join(tmp,`${tool}-${Date.now().toString(36)}-${i}${input?'.in':'.out'}`);temps.push(file);args[i]=file;
   if(input){ctx.fs.writeFile(file,ctx.stdin instanceof EmptyInput?new Uint8Array():await ctx.stdin.readAll(2**31));}
   else{stdoutFile=file;if(!args.slice(0,i).includes('-f'))throw new CommandError('writing to stdout needs the format given with -f (for example -f mp4 -movflags frag_keyframe+empty_moov -)',1);}
  }
  // "Aborted()" is how the core's exit() unwinds after every run, not an error of the command.
  log=(type,message)=>{if(message==='Aborted()')return;void(type==='stdout'?ctx.stdout:ctx.stderr).write(message+'\n').catch(()=>{});};
  const left=ctx.host.timeLeft();core.setTimeout(Number.isFinite(left)?Math.max(1000,Math.floor(left)):-1);
  await topUp(core);
  try{
   const main=withFewerCores(()=>callMain(core,tool,args));
   // The core sets ret only when the program calls exit(); otherwise main's own return value is the status.
   const status=core.ret!==-1?core.ret:main??1;
   if(stdoutFile){const data=ctx.fs.readFile(stdoutFile);await ctx.stdout.write(data);}
   return status<0||status>255?1:status;
  }finally{
   core.reset();log=undefined;
   for(const file of temps)try{ctx.fs.unlink(file);}catch{}
   if(ctx.args.some(a=>INFO.test(a)))retire(core);
  }
 });
}
export const ffmpeg:Command=ctx=>run(ctx,'ffmpeg');
export const ffprobe:Command=ctx=>run(ctx,'ffprobe');
