/// <reference lib="webworker" />
import '@renderer/engine/decoder-fix';
import {runProgram} from './programs';

/** The media worker: runs the ffmpeg and ffprobe commands the project service spawns (programs.ts) and streams their
 * output back, as a child process would. Messages: {run:{id,program,args}} and {cancel:id} in; {id,stdout} /
 * {id,stderr} / {id,exit,error?} out. */
const running=new Map<string,AbortController>();
self.onmessage=async(event:MessageEvent)=>{
 const message=event.data;
 if(message?.cancel){running.get(message.cancel)?.abort();return;}
 if(!message?.run)return;
 const {id,program,args}=message.run as {id:string;program:string;args:string[]},controller=new AbortController();running.set(id,controller);
 const post=(value:object,transfer:Transferable[]=[])=>(self as unknown as Worker).postMessage({id,...value},transfer);
 try{const code=await runProgram(program,args,{signal:controller.signal,stdout:data=>post({stdout:data},[data.buffer]),stderr:text=>post({stderr:text})});post({exit:code});}
 catch(error){const aborted=controller.signal.aborted;post({stderr:String((error as Error)?.message??error)});post({exit:aborted?255:1,error:aborted?'canceled':String((error as Error)?.message??error)});}
 finally{running.delete(id);}
};
