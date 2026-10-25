import type {SoundAnalysis} from '@dream/sound';
import type {Analyse} from '../../../project-service/src/sound-runtime';
export type {Analyse} from '../../../project-service/src/sound-runtime';

/** Sound analysis on the web: the same analysis as the desktop's (sound-runtime.ts), in a worker of its own
 * (sound-analysis.worker.ts) that pulls the samples from here as it goes. The worker stops two minutes after its last
 * analysis, which frees the models' memory. */
let worker:Worker|undefined,idle:ReturnType<typeof setTimeout>|undefined,active=0;
const listeners=new Map<string,(message:any)=>void>();
function start(){
 if(worker)return worker;
 worker=new Worker(new URL('./sound-analysis.worker.ts',import.meta.url),{type:'module',name:'gumbo-sound-analysis'});
 worker.onmessage=({data})=>listeners.get(data.id)?.(data);
 return worker;
}
export function soundAnalyser():Analyse{
 return(read,durationSec,signal)=>new Promise<SoundAnalysis>((resolve,reject)=>{
  clearTimeout(idle);active++;
  const id=crypto.randomUUID(),target=start(),source=read[Symbol.asyncIterator]();let held:Float32Array[]=[],heldLength=0;
  const finish=()=>{listeners.delete(id);signal.removeEventListener('abort',abort);if(--active===0)idle=setTimeout(()=>{worker?.terminate();worker=undefined;},120_000);};
  const abort=()=>{target.postMessage({type:'cancel',id});void source.return?.();finish();reject(signal.reason??new DOMException('Aborted','AbortError'));};
  // About ten seconds a message: fewer messages than ffmpeg's small chunks, and never much held at once.
  const next=async()=>{
   try{
    while(heldLength<160_000){const {done,value}=await source.next();if(done)break;held.push(value);heldLength+=value.length;}
    if(!heldLength){target.postMessage({type:'end',id});return;}
    const data=new Float32Array(heldLength);let at=0;for(const part of held){data.set(part,at);at+=part.length;}held=[];heldLength=0;
    target.postMessage({type:'chunk',id,data},[data.buffer]);
   }catch(error){target.postMessage({type:'cancel',id});finish();reject(error);}
  };
  listeners.set(id,message=>{
   if(message.type==='pull')void next();
   else if(message.type==='done'){finish();resolve(message.result);}
   else if(message.type==='failed'){finish();reject(new Error(message.error));}
  });
  signal.addEventListener('abort',abort,{once:true});
  target.postMessage({type:'analyse',id,durationSec,wasmPaths:`${import.meta.env.BASE_URL}ort/`});
 });
}
