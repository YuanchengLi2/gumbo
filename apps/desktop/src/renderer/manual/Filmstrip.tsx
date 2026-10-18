import React,{useEffect,useState} from 'react';
import {Input,UrlSource,ALL_FORMATS,CanvasSink} from 'mediabunny';
import type {Asset} from '@dream/footage';
import {previewUrl} from '../engine/player';

/** Video frames along a timeline block, as CapCut draws them: each tile shows the source frame at its place in the clip.
 * Frames are decoded with WebCodecs from the playback copy (the same file the player shows), so a clip the agent made
 * with effects baked in shows its real picture, not a colour block. Frames sit on a time grid per asset and are shared by
 * every block of that asset; a tile shows the nearest decoded frame until its own arrives. */
const TILE_HEIGHT=96;
const steps=[.1,.25,.5,1,2,4,8,15,30,60,120,300];
type Source={sink?:Promise<CanvasSink|undefined>;frames:Map<number,ImageBitmap>;wanted:Set<number>;busy:boolean;listeners:Set<()=>void>};
const sources=new Map<string,Source>();
const key=(a:Asset)=>a.id+':'+(a.proxyPath?'proxy':'original');

function source(asset:Asset){
 let s=sources.get(key(asset));
 if(!s){s={frames:new Map(),wanted:new Set(),busy:false,listeners:new Set()};sources.set(key(asset),s);}
 return s;
}
function sinkFor(asset:Asset,s:Source){
 s.sink??=(async()=>{const input=new Input({source:new UrlSource(previewUrl(asset)),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack();
  if(!track||!await track.canDecode())return undefined;return new CanvasSink(track,{height:TILE_HEIGHT,fit:'contain'});})().catch(()=>undefined);
 return s.sink;
}
async function pump(asset:Asset,s:Source){
 if(s.busy)return;s.busy=true;
 try{
  while(s.wanted.size){
   const sink=await sinkFor(asset,s);if(!sink){s.wanted.clear();break;}
   const times=[...s.wanted].sort((a,b)=>a-b).slice(0,24);for(const t of times)s.wanted.delete(t);
   // One answer per requested time, in order (null past the end of the video).
   let n=0;for await(const wrapped of sink.canvasesAtTimestamps(times)){const at=times[n++];if(wrapped&&at!==undefined)s.frames.set(at,await createImageBitmap(wrapped.canvas));}
   for(const t of times)if(!s.frames.has(t)){const near=nearest(s,t);if(near!==undefined)s.frames.set(t,s.frames.get(near)!);}
   s.listeners.forEach(l=>l());
  }
 }catch{s.wanted.clear();}
 finally{s.busy=false;}
}
const nearest=(s:Source,t:number)=>{let best:number|undefined;for(const k of s.frames.keys())if(best===undefined||Math.abs(k-t)<Math.abs(best-t))best=k;return best;};

export function Filmstrip({asset,srcIn,speed,width,height,pps}:{asset:Asset;srcIn:number;speed:number;width:number;height:number;pps:number}){
 const [url,setUrl]=useState<string>(),[version,setVersion]=useState(0);
 const aspect=asset.width&&asset.height?asset.width/asset.height:16/9,tile=Math.max(24,height*aspect),shown=Math.min(width,16000),count=Math.max(1,Math.ceil(shown/tile));
 // Tiles cover about tile/pps timeline seconds each; frames come from the grid step nearest that, so zooming in decodes more.
 const span=tile/pps*Math.max(speed,0),step=steps.find(s=>s>=span*.9)??steps.at(-1)!,last=Math.max(0,asset.durationSec-.05);
 const times=Array.from({length:count},(_,n)=>Math.min(last,Math.round(Math.max(0,srcIn+(n*tile+tile/2)/pps*speed)/step)*step));
 useEffect(()=>{const s=source(asset),listen=()=>setVersion(v=>v+1);s.listeners.add(listen);
  let missing=false;for(const t of times)if(!s.frames.has(t)){s.wanted.add(t);missing=true;}if(missing)void pump(asset,s);
  return()=>{s.listeners.delete(listen);};},[asset.id,asset.proxyPath,times.join(',')]);
 // The strip is drawn off screen and shown as an image. A canvas on the page is promoted to its own compositing layer once
 // drawn, and a hundred of them made every frame of the page re-layerize (about 20 ms a frame while anything animated).
 useEffect(()=>{
  const s=source(asset);if(!s.frames.size)return;let live=true;
  const dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(shown*dpr)),h=Math.max(1,Math.round(height*dpr)),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');if(!ctx)return;
  times.forEach((t,n)=>{const frame=s.frames.get(t)??s.frames.get(nearest(s,t)!);if(!frame)return;
   const x=n*tile*dpr,tw=tile*dpr,scale=Math.max(tw/frame.width,h/frame.height),fw=frame.width*scale,fh=frame.height*scale;
   ctx.save();ctx.beginPath();ctx.rect(x,0,tw,h);ctx.clip();ctx.drawImage(frame,x+(tw-fw)/2,(h-fh)/2,fw,fh);ctx.restore();});
  void canvas.convertToBlob({type:'image/jpeg',quality:.85}).then(blob=>{if(live)setUrl(URL.createObjectURL(blob));});
  return()=>{live=false;};
 },[version,times.join(','),shown,height,tile]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 return url?<img src={url} className="manual-clip-filmstrip" style={{width:shown,height}} alt="" aria-hidden="true" draggable={false}/>:null;
}
