import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Asset} from '@dream/footage';
import {liveSceneDocument} from '../../../../../../packages/composition/src/live-scene-document';

// At most three scene previews run at once; each scene document is a full runtime, so the rest wait for a free slot.
const LIVE_LIMIT=3,live=new Set<object>(),waiting:(()=>void)[]=[];
function useLiveSlot(wanted:boolean){
 const [owner]=useState(()=>({})),[granted,setGranted]=useState(false);
 useEffect(()=>{
  if(!wanted)return;let active=true;
  const take=()=>{if(!active)return;if(live.size<LIVE_LIMIT){live.add(owner);setGranted(true);}else waiting.push(take);};take();
  return()=>{active=false;if(live.delete(owner)){setGranted(false);waiting.shift()?.();}};
 },[wanted,owner]);
 return granted;
}

// A scene's own code drawn live at one frame, the same way the player runs it; hovering plays it. Nothing is rendered
// to a file, and the frame only mounts while it is on screen. src overrides the document (draft previews).
export function ScenePeek({asset,src}:{asset:Asset;src?:string}){
 const box=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null),ready=useRef(false),request=useRef(0);
 const [visible,setVisible]=useState(false),[document,setDocument]=useState<string>(),[failed,setFailed]=useState(false),[width,setWidth]=useState(0);
 const engine=asset.scene?.format==='engine'||!!src,slot=useLiveSlot(visible);
 const total=Math.max(1,asset.scene?.durationInFrames??1),fps=asset.fps||30,still=Math.min(total-1,Math.round(total*.45));
 const show=(n:number)=>{if(ready.current)frame.current?.contentWindow?.postMessage({dreamScene:true,type:'frame',requestId:++request.current,frame:n,fps},'*');};
 useLayoutEffect(()=>{const node=box.current;if(!node)return;const measure=()=>setWidth(node.clientWidth);measure();const resize=new ResizeObserver(measure);resize.observe(node);const seen=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'200px'});seen.observe(node);return()=>{resize.disconnect();seen.disconnect();};},[]);
 useEffect(()=>{
  if(engine||!visible||document!==undefined)return;const controller=new AbortController();
  fetch('dream-media://'+asset.id+'/original',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.text();}).then(html=>setDocument(liveSceneDocument(html))).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>controller.abort();
 },[visible,asset.id,engine]);
 useEffect(()=>{
  if(!slot)ready.current=false;
  const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||!event.data?.dreamScene)return;
   if(event.data.error){setFailed(true);if(engine)window.dispatchEvent(new CustomEvent('dream:scene-error',{detail:{assetId:asset.id,revisionId:asset.scene?.revisionId,draft:src,message:String(event.data.error),stack:event.data.stack}}));}
   else if(event.data.ready){ready.current=true;show(still);}};
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[slot,still,engine,src]);
 const playing=useRef<number|undefined>(undefined);
 const play=()=>{const start=performance.now(),from=still;const step=(now:number)=>{show((from+Math.floor((now-start)/1000*fps))%total);playing.current=requestAnimationFrame(step);};playing.current=requestAnimationFrame(step);};
 const stop=()=>{if(playing.current)cancelAnimationFrame(playing.current);playing.current=undefined;show(still);};
 useEffect(()=>()=>{if(playing.current)cancelAnimationFrame(playing.current);},[]);
 const scale=width&&asset.width?width/asset.width:0,engineSrc=src??`dream-engine://app/scene/${encodeURIComponent(asset.id)}/index.html?r=${asset.scene?.revisionId.slice(0,16)}`;
 return <div ref={box} className="scene-peek" style={{aspectRatio:`${asset.width||16}/${asset.height||9}`}} onMouseEnter={play} onMouseLeave={stop}>
  {failed?<span className="scene-peek-note">Preview in the player</span>:slot&&scale>0&&(engine?<iframe ref={frame} title={asset.filename} sandbox="allow-scripts" src={engineSrc} tabIndex={-1} style={{width:asset.width,height:asset.height,transform:`scale(${scale})`}}/>:document&&<iframe ref={frame} title={asset.filename} sandbox="allow-scripts" srcDoc={document} tabIndex={-1} style={{width:asset.width,height:asset.height,transform:`scale(${scale})`}}/>)}
 </div>;
}
