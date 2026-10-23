import {Shell} from './shell/shell';
import {CallbackOutput,EmptyInput} from './shell/io';
import type {Command,Host} from './shell/types';
import type {SandboxFS} from './fs/types';
import {unixTools,unavailable} from './tools';
import {mkdirp,tryStat,encoder} from './fs/util';
import {resolve as resolvePath,join} from './path';

/** The process result Roux reads, shaped like the desktop host's (contracts' ProcessResult) with the browser as its
 * isolation. Output keeps the last `maxOutputChars` characters, as the desktop host keeps its last 12000. */
export interface ProcessResult{id:string;status:'complete'|'failed'|'cancelled'|'interrupted';exitCode:number|null;startedAt:string;finishedAt:string;output:string;logPath:string;isolation:'browser';commandHash:string}
export interface RunningProcess{id:string;status:'running';output:string;runningSec:number;command:string}
export interface RunRequest{id?:string;command:string;cwd?:string;timeoutMs?:number;env?:Record<string,string>}
/** run_command's input (packages/orchestrator/src/code-tools.ts). */
export interface RunCommandInput{command?:string;processId?:string;stop?:boolean;cwd?:string;timeoutMs?:number}
export type RunCommandResult={process:ProcessResult|RunningProcess;note?:string};
export interface SandboxAssets{
 /** Folder with pyodide.mjs, pyodide.asm.wasm, python_stdlib.zip and pyodide-lock.json. */
 pyodide?:string;
 /** Where numpy, Pillow and other Pyodide wheels come from (the CDN of the same Pyodide version by default). */
 pyodidePackages?:string;
 /** Folders with @ffmpeg/core (single thread) and @ffmpeg/core-mt (threads; used when SharedArrayBuffer is there). */
 ffmpeg?:string;ffmpegMt?:string;
 /** esbuild-wasm's esbuild.wasm and its browser ESM build. */
 esbuildWasm?:string;esbuildModule?:string;
}
export interface SandboxOptions{
 /** The project folder commands start in (cwd "." resolves here). */
 workspace?:string;
 /** Folders beside the workspace that the programs (ffmpeg, Python) see too, as the shell does: a project's media. */
 mounts?:string[];
 env?:Record<string,string>;
 maxOutputChars?:number;
 /** The most memory one command may use (its programs' wasm heaps and the JS it allocates). */
 memoryLimitBytes?:number;
 /** A folder in the file system for each process's full log (<id>.log), like the desktop's .dream/processes. */
 logDir?:string;
 maxLogBytes?:number;
 /** How long a run_command call waits before the command goes on in the background (4 minutes, like the desktop). */
 waitMs?:number;
 fetch?:typeof fetch;
 assets?:SandboxAssets;
 /** Programs (python, ffmpeg, node, esbuild): the worker passes the lazy browser ones; tests may pass fakes. */
 programs?:Record<string,Command>;
 /** Shared memory the client writes to when it stops a command, so Python can raise KeyboardInterrupt mid-run. */
 interrupt?:Int32Array;
 onOutput?:(id:string,text:string)=>void;
}
const hash=(text:string)=>{let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return(h>>>0).toString(16).padStart(8,'0');};
const newId=()=>'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
/** 60% of what the browser says the device has (navigator.deviceMemory, which stops at 8 GB), at least 1.5 GB and at most
 * 4 GB, the most a 32-bit wasm heap can hold anyway. */
export function defaultMemoryLimit(){const gb=1024**3,device=(globalThis.navigator as {deviceMemory?:number}|undefined)?.deviceMemory;return Math.round(Math.min(4*gb,Math.max(1.5*gb,(device??8)*gb*.6)));}
class Stopped extends Error{constructor(message:string,public kind:'stop'|'timeout'|'memory'){super(message);}}

type Entry={id:string;command:string;started:number;timeoutMs:number;controller:AbortController;done:Promise<ProcessResult>;output:()=>string};
const timedOut=(timeoutMs:number)=>new Stopped(`it ran past its ${Math.round(timeoutMs/1000)}s time limit. Run it with a longer timeoutMs, in the background, or on less material.`,'timeout');
/** Runs commands like the desktop's run_command: each in its own shell over the sandbox's file system, with a time limit,
 * an output cap, a memory guard and a process id to wait on or stop. Runs in a worker in the app and under Node in tests. */
export class Sandbox{
 readonly workspace:string;private running=new Map<string,Entry>();private finished=new Map<string,ProcessResult>();
 private memory=new Map<string,()=>number>();private host:Host;
 constructor(public fs:SandboxFS,public options:SandboxOptions={}){
  this.workspace=options.workspace??'/workspace';mkdirp(fs,this.workspace);
  const commands=new Map<string,Command>(Object.entries({...unixTools,...options.programs}));
  this.host={commands,unavailable,fetch:options.fetch,timeLeft:()=>Infinity,reportMemory:(name,bytes)=>{this.memory.set(name,bytes);},interrupt:options.interrupt,workspace:this.workspace,mounts:options.mounts??[],assets:options.assets};
 }
 /** Names a command can run: the Unix tools and the programs. */
 commands(){return[...this.host.commands.keys()].sort();}
 /** Starts a command and returns its id at once; `done` settles when it ends. */
 start(request:RunRequest):{id:string;done:Promise<ProcessResult>}{
  const id=request.id??newId();if(this.running.has(id))throw new Error(`A command with id ${id} is already running.`);
  const controller=new AbortController(),started=Date.now(),max=this.options.maxOutputChars??12000;
  let output='',logBytes=0;const logPath=this.options.logDir?join(this.options.logDir,id+'.log'):'';
  if(logPath)try{mkdirp(this.fs,this.options.logDir!);this.fs.writeFile(logPath,new Uint8Array());}catch{}
  const emit=(text:string)=>{
   output=(output+text).slice(-max);this.options.onOutput?.(id,text);
   const maxLog=this.options.maxLogBytes??16<<20;
   if(logPath&&logBytes<maxLog){const bytes=encoder.encode(text);const take=bytes.subarray(0,maxLog-logBytes);logBytes+=take.length;try{this.fs.appendFile(logPath,take);}catch{}if(logBytes>=maxLog)try{this.fs.appendFile(logPath,encoder.encode(`\n[log stopped at ${Math.round(maxLog/1048576)} MB]\n`));}catch{}}
  };
  const done=this.execute(id,request,controller,emit,started).then(result=>({...result,output:result.output??output,logPath}));
  const entry:Entry={id,command:request.command,started,timeoutMs:request.timeoutMs??600000,controller,done,output:()=>output};this.running.set(id,entry);
  done.then(result=>{this.running.delete(id);this.finished.set(id,result);if(this.finished.size>100)this.finished.delete(this.finished.keys().next().value!);},()=>this.running.delete(id));
  return{id,done};
 }
 private async execute(id:string,request:RunRequest,controller:AbortController,emit:(text:string)=>void,started:number):Promise<ProcessResult>{
  const timeoutMs=request.timeoutMs??600000,limit=this.options.memoryLimitBytes??defaultMemoryLimit();
  const finish=(status:ProcessResult['status'],exitCode:number|null,output?:string):ProcessResult=>({id,status,exitCode,startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),output:output as string,logPath:'',isolation:'browser',commandHash:hash(JSON.stringify({command:request.command,cwd:request.cwd??'.'}))});
  const cwd=resolvePath(this.workspace,request.cwd??'.');
  if(tryStat(this.fs,cwd)?.type!=='directory'){emit(`sh: cd: ${request.cwd}: No such directory in the workspace\n`);return finish('failed',2);}
  const home=join(this.workspace,'.cache'),tmp=join(home,'tmp');try{mkdirp(this.fs,tmp);}catch{}
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,TMPDIR:tmp,TMP:tmp,TEMP:tmp,SHELL:'/bin/sh',USER:'user',LOGNAME:'user',LANG:'C.UTF-8',TERM:'dumb',DREAM_WORKSPACE:this.workspace,DREAM_SANDBOX:'browser',...this.options.env,...request.env};
  const timer=setTimeout(()=>controller.abort(timedOut(timeoutMs)),timeoutMs);
  const baseline=this.fs.memoryBytes?.()??0;
  const used=()=>{let total=Math.max(0,(this.fs.memoryBytes?.()??0)-baseline);for(const bytes of this.memory.values())try{total+=bytes();}catch{}const heap=(globalThis.performance as {memory?:{usedJSHeapSize:number}}|undefined)?.memory?.usedJSHeapSize;return total+(heap??0);};
  const guard=setInterval(()=>{if(used()>limit)controller.abort(new Stopped(`this command used all ${(limit/1024**3).toFixed(1)} GB of memory a command may use, so it was stopped. Process media in smaller pieces (for example seek with -ss to each range and cut one range per ffmpeg run instead of one filter graph over a whole long file).`,'memory'));},500);
  const interrupt=()=>{if(this.options.interrupt)Atomics.store(this.options.interrupt,0,2);};
  controller.signal.addEventListener('abort',interrupt,{once:true});
  const host:Host={...this.host,timeLeft:()=>Math.max(0,started+timeoutMs-Date.now())};
  const io={in:new EmptyInput(),out:new CallbackOutput(emit),err:new CallbackOutput(emit)};
  const shell=new Shell(this.fs,host,controller.signal,{cwd,env});
  // A stopped command answers at once even if a program inside it is still unwinding.
  const stopped=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
  try{
   const status=await Promise.race([shell.main(request.command,io),stopped]);
   return finish(status===0?'complete':'failed',status);
  }catch(error){
   if(controller.signal.aborted){
    const reason=controller.signal.reason,seconds=Math.round((Date.now()-started)/1000);
    const why=reason instanceof Stopped?(reason.kind==='memory'?`Stopped: ${reason.message}`:`Cancelled after ${seconds}s: ${reason.message}`):`Cancelled after ${seconds}s: ${reason instanceof Error?reason.message:String(reason??'the request was stopped')}.`;
    emit('\n'+why+'\n');return finish(reason instanceof Stopped&&reason.kind==='memory'?'failed':'cancelled',null);
   }
   emit(`\nsh: internal error: ${(error as Error)?.stack??error}\n`);return finish('failed',1);
  }finally{
   clearTimeout(timer);clearInterval(guard);controller.signal.removeEventListener('abort',interrupt);
   if(this.options.interrupt)Atomics.store(this.options.interrupt,0,0);
  }
 }
 /** The result when done, else what it has printed so far after waiting up to `waitMs`. */
 async wait(id:string,waitMs=this.options.waitMs??240000):Promise<ProcessResult|RunningProcess>{
  const done=this.finished.get(id);if(done)return done;
  const entry=this.running.get(id);if(!entry)throw new Error('No command with that processId is running.');
  let timer:any;
  const result=await Promise.race([entry.done,new Promise<undefined>(resolve=>{timer=setTimeout(resolve,waitMs);})]);clearTimeout(timer);
  return result??{id,status:'running',output:entry.output().slice(-6000),runningSec:Math.round((Date.now()-entry.started)/1000),command:entry.command.slice(0,200)};
 }
 /** Stops a command; `timeout` says the client stopped it for its time limit (while a program kept this worker busy). */
 async stop(id:string,reason='Stopped.',timeout=false):Promise<ProcessResult|undefined>{
  const entry=this.running.get(id);if(!entry)return this.finished.get(id);
  entry.controller.abort(timeout?timedOut(entry.timeoutMs):new Stopped(reason.replace(/\.$/,''),'stop'));return entry.done;
 }
 stopAll(reason='Stopped.'){for(const id of[...this.running.keys()])void this.stop(id,reason);}
 list(){return[...this.running.values()].map(e=>({id:e.id,command:e.command.slice(0,200),runningSec:Math.round((Date.now()-e.started)/1000)}));}
 /** run_command as Roux calls it: a command (waiting up to 4 minutes, then it goes on in the background), or a processId
  * to wait on again, or with stop true to end. */
 async runCommand(input:RunCommandInput,waitMs=this.options.waitMs??240000):Promise<RunCommandResult>{
  if(input.processId){
   if(input.stop){const result=await this.stop(input.processId);if(!result)throw new Error('No command with that processId is running.');return{process:result,note:'Stopped.'};}
   const r=await this.wait(input.processId,waitMs);return r.status==='running'?{process:r,note:stillRunning(r)}:{process:r};
  }
  if(!input.command)throw new Error('Give a command, or the processId of one still running.');
  const {id}=this.start({command:input.command,cwd:input.cwd,timeoutMs:input.timeoutMs});
  const r=await this.wait(id,waitMs);return r.status==='running'?{process:r,note:stillRunning(r)}:{process:r};
 }
}
export const stillRunning=(r:RunningProcess)=>`Still running after ${r.runningSec} s; it continues in the background until its timeout. Call run_command with processId "${r.id}" to wait for it again, or with processId and stop true to end it. Finishing the request waits for it.`;
