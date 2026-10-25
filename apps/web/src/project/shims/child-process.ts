import {Buffer} from 'buffer';

/** node:child_process for the project service in the browser. ffmpeg and ffprobe run in the media workers
 * (media/programs.ts) and come back as a child process does: stdout and stderr 'data', then 'exit' and 'close' with the
 * code; kill and an abort signal cancel them. Each program goes to the worker with the fewest running, so Roux's look at
 * a few frames never waits behind a long analysis of a source. Other programs arrive with the agent's sandbox. */
type Listener=(...args:any[])=>void;
class Emitter{private listeners=new Map<string,Listener[]>();on(type:string,fn:Listener){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);return this;}addListener(type:string,fn:Listener){return this.on(type,fn);}once(type:string,fn:Listener){const wrap=(...a:any[])=>{this.off(type,wrap);fn(...a);};return this.on(type,wrap);}off(type:string,fn:Listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(f=>f!==fn));return this;}removeListener(type:string,fn:Listener){return this.off(type,fn);}removeAllListeners(){this.listeners.clear();return this;}emit(type:string,...args:any[]){for(const fn of this.listeners.get(type)??[])fn(...args);return(this.listeners.get(type)?.length??0)>0;}}
class Pipe extends Emitter{private encoding?:string;setEncoding(encoding:string){this.encoding=encoding;return this;}resume(){return this;}pause(){return this;}push(data:Uint8Array){const buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength);this.emit('data',this.encoding?buffer.toString(this.encoding as BufferEncoding):buffer);}}
class Child extends Emitter{
 stdout=new Pipe();stderr=new Pipe();stdin={write(){return true;},end(){}};exitCode:number|null=null;killed=false;readonly pid=Math.floor(Math.random()*1e6)+1000;
 constructor(private id:string,readonly worker:Worker){super();}
 kill(){if(this.exitCode!==null)return false;this.killed=true;this.worker.postMessage({cancel:this.id});return true;}
}
const workers=new Map<Worker,number>(),children=new Map<string,Child>();
export function connectPrograms(...media:Worker[]){
 for(const worker of media){
  workers.set(worker,0);
  worker.addEventListener('message',(event:MessageEvent)=>{const {id,stdout,stderr,exit,error}=event.data??{},child=children.get(id);if(!child)return;
   if(stdout)child.stdout.push(stdout);if(stderr)child.stderr.push(new TextEncoder().encode(stderr));
   if(exit!==undefined){children.delete(id);workers.set(worker,Math.max(0,(workers.get(worker)??1)-1));child.exitCode=exit;if(error==='canceled'&&child.killed)child.emit('error',Object.assign(new Error('The operation was aborted'),{name:'AbortError',code:'ABORT_ERR'}));child.emit('exit',exit,null);child.emit('close',exit,null);}});
 }
}
const programs=new Set(['ffmpeg','ffprobe']);
export function spawn(command:string,args:string[]=[],options:{signal?:AbortSignal}={}){
 const name=command.split(/[\\/]/).pop()!.replace(/\.exe$/i,'').toLowerCase();
 if(!programs.has(name)||!workers.size)throw Object.assign(new Error(`Running ${name} is not available in the browser yet.`),{code:'ENOENT'});
 // The least busy worker; the first when they are equal, so frames of one video usually reuse its open decoder there.
 const worker=[...workers].reduce((best,next)=>next[1]<best[1]?next:best)[0];workers.set(worker,workers.get(worker)!+1);
 const id=crypto.randomUUID(),child=new Child(id,worker);children.set(id,child);
 if(options.signal){if(options.signal.aborted)queueMicrotask(()=>child.kill());else options.signal.addEventListener('abort',()=>child.kill(),{once:true});}
 worker.postMessage({run:{id,program:name,args}});
 return child;
}
const notYet=(what:string)=>{throw new Error(`${what} is not available in the browser yet.`);};
export const execFile=(command:string)=>notYet(`Running ${command}`),exec=execFile,execFileSync=execFile,execSync=execFile,spawnSync=execFile;
export default {spawn,execFile,exec,execFileSync,execSync,spawnSync};
