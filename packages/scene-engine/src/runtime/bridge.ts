import {setFrameTime,realNow} from './determinism';
import {pendingCount,currentEpoch,settled} from './pending';
import type {Registry} from './registry';
import {live,setLive} from './live';

// Animation frames stop in hidden documents (a background tab, an off-screen preview); a timer keeps frames moving.
const raf=()=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,16);requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});
const FRAME_TIMEOUT_MS=55_000;
export const post=(message:Record<string,unknown>)=>parent.postMessage({dreamScene:true,...message},'*');

/** Everything a frame can wait on, beyond the engine's own tracked work. */
async function externalWork(){
 const w=window as any;
 while((w.remotion_delayRenderHandles?.length??0)>0)await new Promise(resolve=>setTimeout(resolve,4));
 await document.fonts.ready;
 await Promise.all(Array.from(document.images).map(img=>img.complete&&img.naturalWidth?undefined:img.decode().catch(()=>undefined)));
 // Playing live, videos run on their own and a frame does not wait on them.
 if(!live.playing)await Promise.all(Array.from(document.querySelectorAll('video')).map(video=>video.seeking?new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true})):undefined));
}

/** Draws one requested frame completely: React commits the frame, CSS/Web animations are seeked, 3D roots advance to
 * the frame's time, and every load the frame depends on finishes before it is acknowledged. */
export function installBridge(registry:Registry,setFrame:(frame:number)=>void){
 let pending:{requestId:number;frame:number;fps:number}|undefined,running=false;
 const draw=async(frame:number,fps:number)=>{
  const seconds=frame/fps;setFrameTime(seconds);setFrame(frame);
  for(const animation of document.getAnimations()){try{animation.pause();animation.currentTime=seconds*1000;}catch{}}
  // Playing live, a frame is shown, not captured: it is drawn and painted once, without waiting for loads to settle
  // (three animation frames and the settling passes held a scene to about ten frames a second).
  if(live.playing){for(const hook of registry.frameHooks)hook(seconds);await raf();return;}
  const deadline=realNow()+FRAME_TIMEOUT_MS;
  for(let pass=0;pass<40;pass++){
   const epoch=currentEpoch();
   await raf();
   for(const hook of registry.frameHooks)hook(seconds);
   await Promise.race([Promise.all([settled(),externalWork()]),new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Frame ${frame} was still loading after ${FRAME_TIMEOUT_MS/1000}s.`)),Math.max(0,deadline-realNow())))]);
   if(epoch===currentEpoch()&&!pendingCount())break;
  }
  for(const hook of registry.frameHooks)hook(seconds);
  await raf();await raf();
 };
 const drain=async()=>{
  if(running)return;running=true;
  while(pending){const request=pending;pending=undefined;
   try{await draw(request.frame,request.fps);post({requestId:request.requestId});}
   catch(error){post({requestId:request.requestId,error:String((error as Error)?.message??error),stack:(error as Error)?.stack});}
  }
  running=false;
 };
 addEventListener('message',event=>{if(event.source!==parent||!event.data?.dreamScene||event.data.type!=='frame')return;setLive(event.data.playing===true);pending=event.data;void drain();});
}
