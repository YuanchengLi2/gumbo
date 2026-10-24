import type {Event,FsOp,InitResult,ProcessResult,Request,RunRequest,RunningProcess,WorkerOptions} from './protocol';
import {stillRunning,type RunCommandInput,type RunCommandResult} from './sandbox';

export interface ClientOptions{
 /** Starts the worker, e.g. () => new Worker(new URL('@dream/web-sandbox/worker', import.meta.url), {type:'module'}). */
 createWorker:()=>Worker;
 options?:WorkerOptions;
 /** How long a stopped or timed-out command may take to unwind before the worker is terminated and started again. */
 graceMs?:number;
 /** How long run_command waits before the command goes on in the background (4 minutes, like the desktop). */
 waitMs?:number;
 /** A command's time limit when it names none (10 minutes, like the desktop). */
 defaultTimeoutMs?:number;
}
type Tracked={id:string;command:string;started:number;timeoutMs:number;output:string;listeners:Set<(text:string)=>void>;done:Promise<ProcessResult>;resolve:(r:ProcessResult)=>void;stopping?:{kind:'stop'|'timeout';reason:string};timers:ReturnType<typeof setTimeout>[];result?:ProcessResult};
const MAX_OUTPUT=12000;
/** The page's side of the sandbox worker. It keeps its own record of each command (output so far, time limit), so it can
 * answer and stop even while a program blocks the worker: a stuck command is interrupted (Python), then the worker is
 * terminated and started again. */
export class SandboxClient{
 private worker:Worker|undefined;private ready:Promise<InitResult>|undefined;private seq=0;private started=false;
 private calls=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();private processes=new Map<string,Tracked>();private finished=new Map<string,ProcessResult>();
 /** Shared with the worker so a stop reaches Python while it runs; there only when the page is cross-origin isolated. */
 readonly interrupt=typeof SharedArrayBuffer!=='undefined'&&(globalThis as {crossOriginIsolated?:boolean}).crossOriginIsolated?new Int32Array(new SharedArrayBuffer(4)):undefined;
 restarts=0;
 constructor(private config:ClientOptions){}
 /** Starts the worker (once; again after a restart). Returns what it can run and whether ffmpeg has threads. */
 start():Promise<InitResult>{
  if(this.ready)return this.ready;
  const worker=this.config.createWorker();this.worker=worker;this.started=false;
  worker.onmessage=(event:MessageEvent<Event>)=>this.receive(event.data);
  // A worker that fails before it is ready did not start at all: its script could not load (most often a page left open
  // across an update of the site) or the browser is short of memory. Retrying will not help, so the message says what will.
  worker.onerror=event=>{event.preventDefault?.();this.restart(this.started?`The sandbox worker failed: ${event.message||'unknown error'}.`:`The sandbox could not start (${event.message||'its worker did not load'}). Commands are unavailable until the page is reloaded: carry on without them, and tell the user to reload Gumbo if they are needed.`);};
  this.ready=this.call<InitResult>({type:'init',options:this.config.options??{},interrupt:this.interrupt});
  this.ready.then(()=>{this.started=true;},()=>{this.ready=undefined;});
  return this.ready;
 }
 private receive(event:Event){
  if(event.type==='reply'){const call=this.calls.get(event.id);if(!call)return;this.calls.delete(event.id);if(event.ok)call.resolve(event.value);else call.reject(new Error(event.error));return;}
  const p=this.processes.get(event.processId);if(!p)return;
  if(event.type==='output'){p.output=(p.output+event.text).slice(-MAX_OUTPUT);for(const l of p.listeners)l(event.text);return;}
  if(event.type==='done')this.settle(p,event.result);
 }
 private call<T>(request:Request):Promise<T>{
  const worker=this.worker;if(!worker)return Promise.reject(new Error('The sandbox is not started.'));
  const id=++this.seq;return new Promise<T>((resolve,reject)=>{this.calls.set(id,{resolve,reject});worker.postMessage({...request,id});});
 }
 /** A result as Roux reads it: a command that was stopped or ran out of time says so, even if the program inside it
  * ended on its own when interrupted (Python's KeyboardInterrupt). */
 private settle(p:Tracked,result:ProcessResult){
  if(p.result)return;
  for(const t of p.timers)clearTimeout(t);
  if(p.stopping&&result.status!=='cancelled'){
   const seconds=Math.round((Date.now()-p.started)/1000);
   result={...result,status:'cancelled',exitCode:null,output:(result.output.trimEnd()+'\n\n'+(p.stopping.kind==='timeout'?`Cancelled after ${seconds}s: it ran past its ${Math.round(p.timeoutMs/1000)}s time limit. Run it with a longer timeoutMs, in the background, or on less material.`:`Cancelled after ${seconds}s: ${p.stopping.reason.replace(/\.$/,'')}.`)+'\n').slice(-MAX_OUTPUT)};
  }
  if(this.interrupt)Atomics.store(this.interrupt,0,0);
  p.result=result;this.processes.delete(p.id);this.finished.set(p.id,result);if(this.finished.size>100)this.finished.delete(this.finished.keys().next().value!);
  p.resolve(result);
 }
 /** Starts a command; `done` settles with its result. onOutput hears its output as it comes. */
 async run(request:RunRequest,onOutput?:(text:string)=>void):Promise<{id:string;done:Promise<ProcessResult>}>{
  await this.start();
  const timeoutMs=request.timeoutMs??this.config.defaultTimeoutMs??600000;request={...request,timeoutMs};
  const {id}=await this.call<{id:string}>({type:'start',request});
  let resolve!:(r:ProcessResult)=>void;const done=new Promise<ProcessResult>(r=>{resolve=r;});
  const p:Tracked={id,command:request.command,started:Date.now(),timeoutMs,output:'',listeners:new Set(onOutput?[onOutput]:[]),done,resolve,timers:[]};
  this.processes.set(id,p);
  // The worker enforces the time limit itself; this one fires only if a program keeps the worker from doing so.
  p.timers.push(setTimeout(()=>this.halt(p,'timeout','it ran past its time limit'),timeoutMs+1000));
  return{id,done};
 }
 private halt(p:Tracked,kind:'stop'|'timeout',reason:string){
  if(p.result)return;p.stopping??={kind,reason};
  if(this.interrupt)Atomics.store(this.interrupt,0,2);
  this.worker?.postMessage({type:'stop',processId:p.id,reason,timeout:kind==='timeout',id:++this.seq});
  p.timers.push(setTimeout(()=>{if(!p.result)this.restart(`The sandbox was restarted to stop a command that did not respond (${p.command.slice(0,80)}).`);},this.config.graceMs??3000));
 }
 /** Terminates the worker (a program inside it would not stop) and ends what ran in it; the next command starts a new one. */
 restart(reason:string){
  this.restarts++;this.worker?.terminate();this.worker=undefined;this.ready=undefined;
  for(const call of this.calls.values())call.reject(new Error(reason));this.calls.clear();
  // 'interrupted' becomes 'cancelled' in settle, with the note saying why.
  for(const p of[...this.processes.values()]){p.stopping??={kind:'stop',reason};this.settle(p,{id:p.id,status:'interrupted',exitCode:null,startedAt:new Date(p.started).toISOString(),finishedAt:new Date().toISOString(),output:p.output,logPath:'',isolation:'browser',commandHash:''});}
 }
 async wait(id:string,waitMs=this.config.waitMs??240000):Promise<ProcessResult|RunningProcess>{
  const done=this.finished.get(id);if(done)return done;
  const p=this.processes.get(id);if(!p)throw new Error('No command with that processId is running.');
  let timer:any;const result=await Promise.race([p.done,new Promise<undefined>(r=>{timer=setTimeout(r,waitMs);})]);clearTimeout(timer);
  return result??{id,status:'running',output:p.output.slice(-6000),runningSec:Math.round((Date.now()-p.started)/1000),command:p.command.slice(0,200)};
 }
 async stop(id:string,reason='Stopped.'):Promise<ProcessResult|undefined>{const p=this.processes.get(id);if(!p)return this.finished.get(id);this.halt(p,'stop',reason);return p.done;}
 /** run_command as Roux calls it (packages/orchestrator/src/code-tools.ts). */
 async runCommand(input:RunCommandInput,waitMs=this.config.waitMs??240000):Promise<RunCommandResult>{
  if(input.processId){
   if(input.stop){const result=await this.stop(input.processId);if(!result)throw new Error('No command with that processId is running.');return{process:result,note:'Stopped.'};}
   const r=await this.wait(input.processId,waitMs);return r.status==='running'?{process:r,note:stillRunning(r)}:{process:r};
  }
  if(!input.command)throw new Error('Give a command, or the processId of one still running.');
  const {id}=await this.run({command:input.command,cwd:input.cwd,timeoutMs:input.timeoutMs});
  const r=await this.wait(id,waitMs);return r.status==='running'?{process:r,note:stillRunning(r)}:{process:r};
 }
 /** The desktop's ProcessRunner shape (contracts' ProcessRunner), so project-service can use the sandbox as is. */
 runner(){
  return async(request:{id:string;command:string;cwd?:string;timeoutMs?:number},signal:AbortSignal,onOutput:(text:string)=>void):Promise<ProcessResult>=>{
   const {id,done}=await this.run({id:request.id,command:request.command,cwd:request.cwd,timeoutMs:request.timeoutMs},onOutput);
   const stop=()=>{void this.stop(id,typeof signal.reason==='string'?signal.reason:signal.reason instanceof Error?signal.reason.message:'the request was stopped');};
   if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
   try{return await done;}finally{signal.removeEventListener('abort',stop);}
  };
 }
 private async fs<T>(op:FsOp):Promise<T>{await this.start();return this.call<T>({type:'fs',fs:op});}
 readFile(path:string){return this.fs<Uint8Array>({op:'read',path});}
 writeFile(path:string,data:Uint8Array|string){return this.fs<boolean>({op:'write',path,data});}
 readdir(path:string){return this.fs<string[]>({op:'list',path});}
 remove(path:string){return this.fs<boolean>({op:'remove',path});}
 running(){return[...this.processes.values()].map(p=>({id:p.id,command:p.command.slice(0,200),runningSec:Math.round((Date.now()-p.started)/1000)}));}
 terminate(){this.restart('The sandbox was closed.');}
}
