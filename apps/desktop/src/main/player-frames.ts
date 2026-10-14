import {randomUUID} from 'node:crypto';
import type {BrowserWindow} from 'electron';
import {ReviewRenderRequestSchema,ReviewImagesSchema,type ReviewRenderRequest,type ReviewImages} from '@dream/contracts';

/** Frames of the edit for the agent, drawn by the editor window's own engine: the request goes to the window as an event,
 * the window draws the frames with the compositor the player and Export use, and answers through dream:framesResult.
 * There is no separate renderer: what the agent sees is what the player shows. */
export class PlayerFrames{
 private waiting=new Map<string,{resolve:(images:ReviewImages)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private window:()=>BrowserWindow|undefined,private timeoutMs=120_000){}
 request(raw:ReviewRenderRequest,signal:AbortSignal):Promise<ReviewImages>{
  const request=ReviewRenderRequestSchema.parse(raw),win=this.window();
  if(!win||win.isDestroyed())return Promise.reject(new Error('The editor window is closed, so frames cannot be drawn now.'));
  const id=randomUUID();
  return new Promise<ReviewImages>((resolve,reject)=>{
   const done=()=>{const entry=this.waiting.get(id);if(entry){clearTimeout(entry.timer);this.waiting.delete(id);}signal.removeEventListener('abort',abort);};
   const abort=()=>{done();reject(signal.reason instanceof Error?signal.reason:new Error('Stopped.'));};
   const timer=setTimeout(()=>{done();reject(new Error('The editor did not draw the frames in time.'));},this.timeoutMs);
   this.waiting.set(id,{resolve:images=>{done();resolve(images);},reject:error=>{done();reject(error);},timer});
   signal.addEventListener('abort',abort,{once:true});
   win.webContents.send('dream:event',{type:'frames.request',payload:{id,...request}});
  });
 }
 settle(id:string,result:unknown){
  const entry=this.waiting.get(String(id));if(!entry)return;
  const error=(result as {error?:unknown})?.error;if(error){entry.reject(new Error(String(error)));return;}
  try{entry.resolve(ReviewImagesSchema.parse(result));}catch(failure){entry.reject(new Error('The editor returned unreadable frames: '+(failure as Error).message.slice(0,200)));}
 }
}
