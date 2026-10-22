import {Input,UrlSource,ALL_FORMATS,VideoSampleSink} from 'mediabunny';
import {prepare,frameAt,Compositor,type MediaLayer,type Picture} from '@dream/compositor';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';
import {previewUrl} from './player';
import {SceneCaptures} from './scenes';
import {originalUrl,decodedAsPlayed} from './export';

/** Frames of the edit for the agent to look at, drawn by the same compositor the player and Export use (source frames
 * decoded exactly, scenes drawn by their own documents), at the moments it asks for. Each comes with measured colours: the
 * whole frame's average and a 3x3 grid of region averages (top-left to bottom-right), so a tint or a colour can be checked
 * as a number, not only by eye. Nothing is encoded into a video. */
export type FrameRequest={versionId:string;timeline:TimelineDocument;footage:FootageIndex;frames:{frame:number;labels:string[]}[];maxSide?:number};
const hex=(r:number,g:number,b:number)=>'#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
async function measure(canvas:OffscreenCanvas){
 const bitmap=await createImageBitmap(canvas),w=48,h=Math.max(3,Math.round(48*canvas.height/canvas.width)),small=new OffscreenCanvas(w,h),context=small.getContext('2d')!;
 context.drawImage(bitmap,0,0,w,h);bitmap.close();const d=context.getImageData(0,0,w,h).data;
 const average=(x0:number,y0:number,x1:number,y1:number)=>{let r=0,g=0,b=0,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*w+x)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++;}return n?hex(r/n,g/n,b/n):'#000000';};
 const grid:string[]=[];for(let gy=0;gy<3;gy++)for(let gx=0;gx<3;gx++)grid.push(average(Math.floor(gx*w/3),Math.floor(gy*h/3),Math.floor((gx+1)*w/3),Math.floor((gy+1)*h/3)));
 return{mean:average(0,0,w,h),grid};
}
const base64=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text);};
const sha256=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');

export async function grabFrames(request:FrameRequest){
 const p=prepare({timeline:request.timeline,footage:request.footage}),{width,height,fps}=request.timeline.settings,scale=Math.min(1,(request.maxSide??960)/Math.max(width,height));
 const canvas=new OffscreenCanvas(Math.max(2,Math.round(width*scale)),Math.max(2,Math.round(height*scale))),compositor=new Compositor(canvas),scenes=new SceneCaptures();
 const inputs:Input[]=[],sinks=new Map<string,Promise<VideoSampleSink|undefined>>(),images=new Map<string,ImageBitmap>();
 // The original when this computer can decode it, else the playback copy made at import.
 const sinkFor=(asset:Asset)=>{let sink=sinks.get(asset.id);if(!sink){sink=(async()=>{for(const url of [originalUrl(asset),previewUrl(asset)]){try{const input=new Input({source:new UrlSource(url),formats:ALL_FORMATS});inputs.push(input);const track=await input.getPrimaryVideoTrack();if(track&&await track.canDecode())return new VideoSampleSink(await decodedAsPlayed(track));}catch{}}return undefined;})();sinks.set(asset.id,sink);}return sink;};
 const image=async(url:string)=>{let bitmap=images.get(url);if(!bitmap){bitmap=await createImageBitmap(await (await fetch(url)).blob());images.set(url,bitmap);}return bitmap;};
 const frames=[];
 try{
  for(const f of request.frames){
   const frame=frameAt(p,f.frame/fps),pictures=new Map<MediaLayer,Picture>(),opened:{close():void}[]=[],missing:string[]=[];
   for(const layer of frame.layers){if(layer.kind!=='media')continue;const asset=p.assets.get(layer.assetId);if(!asset)continue;
    try{
     if(layer.media==='video'){const sample=await (await sinkFor(asset))?.getSample(layer.time);if(sample){opened.push(sample);pictures.set(layer,sample.toCanvasImageSource());}else missing.push(asset.filename);}
     else if(layer.media==='scene')pictures.set(layer,await scenes.picture(layer,asset));
     else pictures.set(layer,await image(layer.media==='sequence'?previewUrl(asset)+'&frame='+(layer.frameIndex??0):previewUrl(asset)));
    }catch(error){missing.push(`${asset.filename} (${(error as Error).message})`);}}
   compositor.draw(frame,layer=>pictures.get(layer));
   const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg',quality:.82})).arrayBuffer()),stats=await measure(canvas);
   for(const sample of opened)sample.close();
   const printed=scenes.takeLogs().map(line=>('console '+line).slice(0,200));
   frames.push({...f,labels:[...f.labels,...missing.map(m=>('not drawn: '+m).slice(0,200)),...printed].slice(0,20),mimeType:'image/jpeg' as const,data:base64(bytes),sha256:await sha256(bytes),stats});
  }
  return{versionId:request.versionId,frames};
 }finally{scenes.close();for(const b of images.values())b.close();for(const input of inputs)input.dispose?.();compositor.dispose();}
}
