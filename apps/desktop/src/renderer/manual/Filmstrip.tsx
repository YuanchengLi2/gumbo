import React,{useEffect,useRef,useState} from 'react';
import type {Asset} from '@dream/footage';
import {previewUrl} from '../engine/player';

/** Video frames along a timeline block, as CapCut draws them: each tile shows the source frame at its place in the clip.
 * Frames are decoded with WebCodecs (in frames-worker.ts) from the playback copy (the same file the player shows), so a
 * clip the agent made with effects baked in shows its real picture, not a colour block. Frames sit on a time grid per
 * asset and are shared by every block of that asset; a tile shows the nearest decoded frame until its own arrives. */
const TILE_HEIGHT=96;
/** Chat tiles (a selected clip, attached media) are larger than a timeline tile. */
const STILL_HEIGHT=192;
const steps=[.1,.25,.5,1,2,4,8,15,30,60,120,300];
// Each decoded frame becomes a small picture once, kept by its time. Strips used to be drawn whole on a canvas and encoded
// again for every zoom step and every block that changed (seconds of work while zooming a long edit).
type Source={height:number;frames:Map<number,string>;wanted:Set<number>;busy:boolean;failed:boolean;listeners:Set<(times:Set<number>|null)=>void>};
const sources=new Map<string,Source>();
const key=(a:Asset,height:number)=>a.id+':'+(a.proxyPath?'proxy':'original')+':'+height;

function source(asset:Asset,height=TILE_HEIGHT){
 let s=sources.get(key(asset,height));
 if(!s){s={height,frames:new Map(),wanted:new Set(),busy:false,failed:false,listeners:new Set()};sources.set(key(asset,height),s);}
 return s;
}
// The decoding worker, made when the first frame is asked for; a batch it cannot answer (or a worker that fails) is failed.
type Answer={frames:[number,Blob][]}|{failed:true};
let worker:Worker|undefined,asked=0;const waiting=new Map<number,(answer:Answer)=>void>();
function decode(url:string,height:number,quality:number,times:number[]){
 if(!worker){worker=new Worker(new URL('./frames-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=(e:MessageEvent<{id:number}&Answer>)=>{const {id,...answer}=e.data;waiting.get(id)?.(answer as Answer);waiting.delete(id);};
  worker.onerror=()=>{for(const done of waiting.values())done({failed:true});waiting.clear();};}
 const id=++asked;return new Promise<Answer>(done=>{waiting.set(id,done);worker!.postMessage({id,url,height,quality,times});});
}
async function pump(asset:Asset,s:Source){
 if(s.busy)return;s.busy=true;
 try{
  while(s.wanted.size){
   const times=[...s.wanted].sort((a,b)=>a-b).slice(0,24);for(const t of times)s.wanted.delete(t);
   const answer=await decode(previewUrl(asset),s.height,s.height>TILE_HEIGHT?.92:.85,times);if('failed' in answer){s.wanted.clear();s.failed=true;s.listeners.forEach(l=>l(null));break;}
   for(const [at,blob] of answer.frames)s.frames.set(at,URL.createObjectURL(blob));
   for(const t of times)if(!s.frames.has(t)){const near=nearest(s,t);if(near!==undefined)s.frames.set(t,s.frames.get(near)!);}
   // Only the strips and tiles showing these times draw again: a long edit cut from one source has hundreds of blocks.
   const done=new Set(times);s.listeners.forEach(l=>l(done));
  }
 }catch{s.wanted.clear();s.failed=true;s.listeners.forEach(l=>l(null));}
 finally{s.busy=false;}
}
const nearest=(s:Source,t:number)=>{let best:number|undefined;for(const k of s.frames.keys())if(best===undefined||Math.abs(k-t)<Math.abs(best-t))best=k;return best;};

function FilmstripView({asset,srcIn,speed,width,height,pps}:{asset:Asset;srcIn:number;speed:number;width:number;height:number;pps:number}){
 const [,setVersion]=useState(0),drawn=useRef<{times:number[];empty:boolean}>({times:[],empty:true});
 const aspect=asset.width&&asset.height?asset.width/asset.height:16/9,tile=Math.max(24,height*aspect),shown=Math.min(width,16000),count=Math.max(1,Math.ceil(shown/tile));
 // Tiles cover about tile/pps timeline seconds each; frames come from the grid step nearest that, so zooming in decodes more.
 const span=tile/pps*Math.max(speed,0),step=steps.find(s=>s>=span*.9)??steps.at(-1)!,last=Math.max(0,asset.durationSec-.05);
 const times=Array.from({length:count},(_,n)=>Math.min(last,Math.round(Math.max(0,srcIn+(n*tile+tile/2)/pps*speed)/step)*step));
 useEffect(()=>{const s=source(asset),listen=(got:Set<number>|null)=>{if(!got||drawn.current.empty||drawn.current.times.some(t=>got.has(t)))setVersion(v=>v+1);};s.listeners.add(listen);
  let missing=false;for(const t of times)if(!s.frames.has(t)){s.wanted.add(t);missing=true;}if(missing)void pump(asset,s);
  return()=>{s.listeners.delete(listen);};},[asset.id,asset.proxyPath,times.join(',')]);
 // Tiles are pictures, not a canvas: a canvas on the page is promoted to its own compositing layer once drawn, and a
 // hundred of them made every frame of the page re-layerize (about 20 ms a frame while anything animated).
 const s=source(asset);drawn.current={times,empty:!s.frames.size};if(!s.frames.size)return null;
 return <div className="manual-clip-filmstrip" style={{width:shown,height}} aria-hidden="true">{times.map((t,n)=>{const url=s.frames.get(t)??s.frames.get(nearest(s,t)!);
  return url?<span key={n} style={{left:n*tile,width:tile,backgroundImage:`url("${url}")`}}/>:null;})}</div>;
}
/** Drawn again only when its block or its frames change, not for each redraw of the timeline (a click, a scroll). */
export const Filmstrip=React.memo(FilmstripView);

/** A video's frame at a time, from the same shared decoder, as a picture. Chat tiles (a selected clip, attached media)
 * showed it with a video element each, and every one opened its own decoder: selecting clips kept the GPU busy for a
 * quarter of a second a click. `failed` says the frame cannot be decoded here, so a video element is the fallback. */
export function useVideoFrame(asset:Asset|undefined,time:number){
 const [,setVersion]=useState(0),s=asset?source(asset,STILL_HEIGHT):undefined,t=Math.max(0,Math.min(time,(asset?.durationSec??0)-.05));
 useEffect(()=>{if(!asset||!s)return;const listen=(got:Set<number>|null)=>{if(!got||got.has(t))setVersion(v=>v+1);};s.listeners.add(listen);if(!s.frames.has(t)&&!s.failed){s.wanted.add(t);void pump(asset,s);}
  return()=>{s.listeners.delete(listen);};},[asset?.id,asset?.proxyPath,t]);
 return{url:s?.frames.get(t),failed:!!s?.failed};
}
