import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {cancelRender,continueRender,delayRender,useCurrentFrame,useVideoConfig} from 'remotion';
import type {Asset} from '@dream/footage';
import {liveSceneDocument} from './live-scene-document';

export function LiveScene({asset,src,sourceIn=0,speed=1,style,exporting=false}:{asset:Asset;src:string;sourceIn?:number;speed?:number;style?:React.CSSProperties;exporting?:boolean}){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),iframe=useRef<HTMLIFrameElement>(null),container=useRef<HTMLDivElement>(null);
 const [html,setHtml]=useState<string>(),[error,setError]=useState<string>(),[size,setSize]=useState({width:asset.width,height:asset.height});
 const ready=useRef(false),sequence=useRef(0),waiting=useRef<{id:number;handle:number}|undefined>(undefined);
 const [initialHandle]=useState(()=>exporting?delayRender('Loading live scene '+asset.filename):undefined);
 const current=useRef({frame:0,fps:asset.fps});
 current.current={frame:Math.max(0,Math.min(asset.scene!.durationInFrames-1,Math.floor((sourceIn+Math.max(0,frame)/fps*speed)*asset.fps))),fps:asset.fps};
 const release=()=>{if(waiting.current){continueRender(waiting.current.handle);waiting.current=undefined;}if(initialHandle!==undefined)continueRender(initialHandle);};
 const send=()=>{if(!ready.current)return;const id=++sequence.current;if(exporting){if(waiting.current)continueRender(waiting.current.handle);waiting.current={id,handle:delayRender('Drawing scene frame '+current.current.frame)};}iframe.current?.contentWindow?.postMessage({dreamScene:true,type:'frame',requestId:id,...current.current},'*');};
 useEffect(()=>{
  const controller=new AbortController();ready.current=false;
  fetch(src,{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('Scene source unavailable.');return response.text();}).then(setHtml).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[src]);
 useLayoutEffect(()=>{const node=container.current;if(!node)return;const resize=()=>setSize({width:node.clientWidth,height:node.clientHeight});resize();const observer=new ResizeObserver(resize);observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{if(event.source!==iframe.current?.contentWindow||!event.data?.dreamScene)return;
   if(event.data.error){setError(String(event.data.error));release();return;}
   if(event.data.ready){ready.current=true;send();return;}
   if(event.data.requestId===sequence.current)release();
  };
  window.addEventListener('message',receive);return()=>{window.removeEventListener('message',receive);release();};
 },[src,exporting]);
 useLayoutEffect(()=>{send();},[frame,sourceIn,speed]);
 const document=useMemo(()=>html===undefined?undefined:liveSceneDocument(html),[html]);
 if(error){if(exporting)cancelRender(new Error(error));return <div role="alert" style={{position:'absolute',inset:0,padding:24,background:'#161c26',color:'#fff'}}>Scene {asset.filename}: {error}</div>;}
 const scale=style?.objectFit==='cover'?Math.max(size.width/asset.width,size.height/asset.height):Math.min(size.width/asset.width,size.height/asset.height);
 return <div ref={container} style={{position:'absolute',inset:0,overflow:'hidden',...style}}><iframe ref={iframe} title={asset.filename} sandbox="allow-scripts" srcDoc={document} style={{position:'absolute',border:0,width:asset.width,height:asset.height,left:'50%',top:'50%',transform:`translate(-50%,-50%) scale(${scale})`,transformOrigin:'center',pointerEvents:'none'}}/></div>;
}
