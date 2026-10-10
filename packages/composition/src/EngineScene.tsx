import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {cancelRender,continueRender,delayRender,useCurrentFrame,useVideoConfig} from 'remotion';
import type {Asset} from '@dream/footage';
import {sceneFrameIndex} from '@dream/scene-engine';

/** Reports a scene failure from the visible player so the agent can see it in its next step (never during export). */
const reportError=(asset:Asset,message:string,stack?:string)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dream:scene-error',{detail:{assetId:asset.id,revisionId:asset.scene?.revisionId,message,stack}}));};

/** An engine scene: compiled code run by the prebuilt scene engine in its own document (dream-engine:// in the player,
 * the loopback render server during export). Uses the same frame request protocol and timing as LiveScene. */
export function EngineScene({asset,engineBase,sourceIn=0,speed=1,style,exporting=false}:{asset:Asset;engineBase:string;sourceIn?:number;speed?:number;style?:React.CSSProperties;exporting?:boolean}){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),iframe=useRef<HTMLIFrameElement>(null),container=useRef<HTMLDivElement>(null);
 const [error,setError]=useState<string>(),[size,setSize]=useState({width:asset.width,height:asset.height});
 const ready=useRef(false),sequence=useRef(0),waiting=useRef<{id:number;handle:number}|undefined>(undefined);
 const [initialHandle]=useState(()=>exporting?delayRender('Loading scene '+asset.filename,{timeoutInMilliseconds:60_000}):undefined);
 const current=useRef({frame:0,fps:asset.fps});
 current.current={frame:sceneFrameIndex({frame,fps,sourceIn,speed,sceneFps:asset.fps,durationInFrames:asset.scene!.durationInFrames}),fps:asset.fps};
 const src=`${engineBase.replace(/\/$/,'')}/scene/${encodeURIComponent(asset.id)}/index.html?r=${asset.scene!.revisionId.slice(0,16)}`;
 const release=()=>{if(waiting.current){continueRender(waiting.current.handle);waiting.current=undefined;}if(initialHandle!==undefined)continueRender(initialHandle);};
 const send=()=>{if(!ready.current)return;const id=++sequence.current;if(exporting){if(waiting.current)continueRender(waiting.current.handle);waiting.current={id,handle:delayRender('Drawing scene frame '+current.current.frame,{timeoutInMilliseconds:60_000})};}iframe.current?.contentWindow?.postMessage({dreamScene:true,type:'frame',requestId:id,...current.current},'*');};
 useLayoutEffect(()=>{const node=container.current;if(!node)return;const resize=()=>setSize({width:node.clientWidth,height:node.clientHeight});resize();const observer=new ResizeObserver(resize);observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  ready.current=false;
  const receive=(event:MessageEvent)=>{if(event.source!==iframe.current?.contentWindow||!event.data?.dreamScene)return;
   if(event.data.error){const message=String(event.data.error);if(exporting){cancelRender(new Error(`Scene ${asset.filename}: ${message}`));return;}if(event.data.fatal||event.data.requestId===sequence.current)setError(message);reportError(asset,message,event.data.stack);release();return;}
   if(event.data.ready){ready.current=true;setError(undefined);send();return;}
   if(event.data.requestId===sequence.current)release();
  };
  window.addEventListener('message',receive);return()=>{window.removeEventListener('message',receive);release();};
 },[src,exporting]);
 useLayoutEffect(()=>{send();},[frame,sourceIn,speed]);
 const scale=style?.objectFit==='cover'?Math.max(size.width/asset.width,size.height/asset.height):Math.min(size.width/asset.width,size.height/asset.height);
 return <div ref={container} style={{position:'absolute',inset:0,overflow:'hidden',...style}}>
  <iframe ref={iframe} title={asset.filename} sandbox="allow-scripts" src={src} style={{position:'absolute',border:0,width:asset.width,height:asset.height,left:'50%',top:'50%',transform:`translate(-50%,-50%) scale(${scale})`,transformOrigin:'center',pointerEvents:'none',background:'transparent'}}/>
  {error&&!exporting&&<div role="alert" style={{position:'absolute',left:12,right:12,bottom:12,padding:'10px 14px',borderRadius:8,background:'#2a1215ee',color:'#ffd9dc',font:'13px/1.4 system-ui,sans-serif'}}>Scene {asset.filename}: {error}</div>}
 </div>;
}
