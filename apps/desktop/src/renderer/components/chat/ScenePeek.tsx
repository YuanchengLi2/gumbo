import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Asset} from '@dream/footage';
import {liveSceneDocument} from '../../../../../../packages/composition/src/live-scene-document';

// A published scene's own code drawn live at one frame, the same way the player runs it; hovering plays it.
// Nothing is rendered to a file, and the frame only mounts while it is on screen.
export function ScenePeek({asset}:{asset:Asset}){
 const box=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null),ready=useRef(false),request=useRef(0);
 const [visible,setVisible]=useState(false),[document,setDocument]=useState<string>(),[failed,setFailed]=useState(false),[width,setWidth]=useState(0);
 const total=Math.max(1,asset.scene?.durationInFrames??1),fps=asset.fps||30,still=Math.min(total-1,Math.round(total*.45));
 const show=(n:number)=>{if(ready.current)frame.current?.contentWindow?.postMessage({dreamScene:true,type:'frame',requestId:++request.current,frame:n,fps},'*');};
 useLayoutEffect(()=>{const node=box.current;if(!node)return;const measure=()=>setWidth(node.clientWidth);measure();const resize=new ResizeObserver(measure);resize.observe(node);const seen=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'200px'});seen.observe(node);return()=>{resize.disconnect();seen.disconnect();};},[]);
 useEffect(()=>{
  if(!visible||document!==undefined)return;const controller=new AbortController();
  fetch('dream-media://'+asset.id+'/original',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.text();}).then(html=>setDocument(liveSceneDocument(html))).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>controller.abort();
 },[visible,asset.id]);
 useEffect(()=>{
  if(!visible)ready.current=false;
  const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||!event.data?.dreamScene)return;if(event.data.error)setFailed(true);else if(event.data.ready){ready.current=true;show(still);}};
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[visible,still]);
 const playing=useRef<number|undefined>(undefined);
 const play=()=>{const start=performance.now(),from=still;const step=(now:number)=>{show((from+Math.floor((now-start)/1000*fps))%total);playing.current=requestAnimationFrame(step);};playing.current=requestAnimationFrame(step);};
 const stop=()=>{if(playing.current)cancelAnimationFrame(playing.current);playing.current=undefined;show(still);};
 useEffect(()=>()=>{if(playing.current)cancelAnimationFrame(playing.current);},[]);
 const scale=width&&asset.width?width/asset.width:0;
 return <div ref={box} className="scene-peek" style={{aspectRatio:`${asset.width||16}/${asset.height||9}`}} onMouseEnter={play} onMouseLeave={stop}>
  {failed?<span className="scene-peek-note">Preview in the player</span>:visible&&document&&scale>0&&<iframe ref={frame} title={asset.filename} sandbox="allow-scripts" srcDoc={document} tabIndex={-1} style={{width:asset.width,height:asset.height,transform:`scale(${scale})`}}/>}
 </div>;
}
