import {Sandbox,type SandboxOptions} from './sandbox';
import {MemoryFS} from './fs/memory';
import type {SandboxFS} from './fs/types';
import {programs} from './programs';
import {threadsAvailable} from './programs/ffmpeg';
import {removeTree,mkdirp,encoder} from './fs/util';
import {dirname} from './path';
import type {Event,FsOp,InitResult,Request} from './protocol';

type Scope={postMessage(message:Event):void;onmessage:((event:MessageEvent<Request&{id:number}>)=>void)|null};
/** Answers the client's messages inside a worker. The web app calls it from its own worker file with its ZenFS (the
 * default sandbox.worker.ts uses an in-memory file system):
 *
 *   serveSandbox(async()=>{await configure(...);return fromZenFS(fs,'/projects/'+id);});
 */
export function serveSandbox(source?:SandboxFS|(()=>SandboxFS|Promise<SandboxFS>),defaults:Partial<SandboxOptions>={}){
 const scope=globalThis as unknown as Scope;let sandbox:Sandbox|undefined;
 // Output is sent in batches, but at least every 50 ms even while a program blocks the worker (ffmpeg, Python).
 const pending=new Map<string,string>();let timer:ReturnType<typeof setTimeout>|undefined,last=0;
 const flush=()=>{timer=undefined;last=Date.now();for(const [processId,text] of pending)scope.postMessage({type:'output',processId,text});pending.clear();};
 const output=(processId:string,text:string)=>{pending.set(processId,(pending.get(processId)??'')+text);if(Date.now()-last>50||(pending.get(processId)!.length>65536))flush();else timer??=setTimeout(flush,50);};
 scope.onmessage=async event=>{
  const message=event.data;
  const reply=(value:unknown)=>scope.postMessage({type:'reply',id:message.id,ok:true,value});
  try{
   if(message.type==='init'){
    const fs=typeof source==='function'?await source():source??new MemoryFS();
    sandbox?.stopAll('The sandbox was restarted.');
    sandbox=new Sandbox(fs,{...defaults,...message.options,interrupt:message.interrupt,programs:{...programs,...defaults.programs},onOutput:output});
    const result:InitResult={commands:sandbox.commands(),threads:threadsAvailable(),crossOriginIsolated:(globalThis as {crossOriginIsolated?:boolean}).crossOriginIsolated===true};
    reply(result);return;
   }
   if(!sandbox)throw new Error('The sandbox is not started yet.');
   switch(message.type){
    case'start':{const {id,done}=sandbox.start(message.request);done.then(result=>{flush();scope.postMessage({type:'done',processId:id,result});});reply({id});return;}
    case'wait':reply(await sandbox.wait(message.processId,message.waitMs));return;
    case'stop':reply(await sandbox.stop(message.processId,message.reason,message.timeout));return;
    case'list':reply(sandbox.list());return;
    case'fs':reply(fsOp(sandbox,message.fs));return;
   }
  }catch(error){scope.postMessage({type:'reply',id:message.id,ok:false,error:(error as Error)?.message??String(error)});}
 };
}
function fsOp(sandbox:Sandbox,op:FsOp){
 const fs=sandbox.fs,path=op.path.startsWith('/')?op.path:sandbox.workspace+'/'+op.path;
 switch(op.op){
  case'read':return fs.readFile(path);
  case'write':mkdirp(fs,dirname(path));fs.writeFile(path,typeof op.data==='string'?encoder.encode(op.data):op.data);return true;
  case'list':return fs.readdir(path);
  case'stat':return fs.stat(path);
  case'mkdir':mkdirp(fs,path);return true;
  case'remove':removeTree(fs,path);return true;
 }
}
