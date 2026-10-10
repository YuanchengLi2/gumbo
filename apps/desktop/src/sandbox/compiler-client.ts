import type {CompiledVisual} from './compile';
import {Worker} from 'node:worker_threads';
import type {VisualDefinition} from '@dream/contracts';
export function compileInWorker(path:string,definition:VisualDefinition,signal:AbortSignal){
 return new Promise<string|CompiledVisual>((resolve,reject)=>{signal.throwIfAborted();const worker=new Worker(path,{workerData:definition,env:{},resourceLimits:{maxOldGenerationSizeMb:384}});let settled=false;
  const finish=async(error?:Error,code?:string|CompiledVisual)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);await worker.terminate();error?reject(error):resolve(code!);};
  const abort=()=>{void finish(new DOMException('Visual compilation canceled','AbortError'));},timer=setTimeout(()=>{void finish(new Error('Visual compilation exceeded its processing deadline.'));},30000);signal.addEventListener('abort',abort,{once:true});
  worker.once('message',result=>{void finish(result.error?new Error(result.error):typeof result.code!=='string'&&(!result.code?.files||result.code?.entry!=='component.js')?new Error('Invalid compiler response.'):undefined,result.code);});worker.once('error',error=>{void finish(error);});worker.once('exit',code=>{if(!settled)void finish(new Error(`The visual compiler stopped early (${code}).`));});
 });
}
