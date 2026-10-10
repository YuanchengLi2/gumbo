import React,{createRef,Component,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Player,type PlayerRef} from '@remotion/player';
import type {VisualDefinition} from '@dream/contracts';

type CaptureAPI={ready:boolean;error?:string;seek:(frame:number)=>Promise<void>};
declare global{interface Window{__dreamCapture:CaptureAPI}}
const api:CaptureAPI={ready:false,seek:async()=>{throw new Error('Visual runtime is starting.');}};window.__dreamCapture=api;
window.addEventListener('error',event=>{api.error=event.message;});window.addEventListener('unhandledrejection',event=>{api.error=String(event.reason?.message??event.reason);});
class Boundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(error:Error){api.error=error.message;}render(){return this.state.failed?null:this.props.children;}}
const framePaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
async function start(){
 const configuration=JSON.parse(document.getElementById('dream-definition')!.textContent!) as {definition:VisualDefinition;assets:Record<string,string>};
 const definition=configuration.definition,ref=createRef<PlayerRef>();let randomState=definition.seed>>>0;
 Math.random=()=>{randomState=(Math.imul(1664525,randomState)+1013904223)>>>0;return randomState/4294967296;};
 // This import is external to the trusted bundle and resolves only inside this render's scoped origin.
 // @ts-expect-error Component is supplied to the isolated HTTP origin at render time.
 const module=await import('../component.js');if(typeof module.default!=='function'&&typeof module.default!=='object')throw new Error('Export a React component as default.');
 flushSync(()=>createRoot(document.getElementById('root')!).render(<Boundary><Player ref={ref} component={module.default} inputProps={{...definition.parameters,assets:configuration.assets,seed:definition.seed}} durationInFrames={definition.durationInFrames} compositionWidth={definition.width} compositionHeight={definition.height} fps={definition.fps} controls={false} errorFallback={({error})=>{api.error=error.message;return null;}} autoPlay={false} initiallyMuted clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} style={{width:definition.width,height:definition.height}}/></Boundary>));
 api.seek=async(frame:number)=>{
  if(api.error)throw new Error(api.error);if(!Number.isInteger(frame)||frame<0||frame>=definition.durationInFrames)throw new Error('Frame is outside the composition.');
  randomState=(definition.seed^Math.imul(frame,2654435761))>>>0;flushSync(()=>ref.current!.seekTo(frame));await document.fonts.ready;await framePaint();
  await Promise.all(Array.from(document.images).map(img=>img.decode()));
  // Remotion synchronizes video elements asynchronously after a frame seek. Wait
  // for decoded media as well as React/image commits before taking the still.
  for(;;){const videos=Array.from(document.querySelectorAll('video'));const failed=videos.find(video=>video.error);if(failed)throw new Error(`Selected video could not decode: ${failed.error!.message}`);if(videos.every(video=>!video.seeking&&video.readyState>=2))break;await framePaint();if(api.error)throw new Error(api.error);}
  await framePaint();if(api.error)throw new Error(api.error);
 };
 await api.seek(0);api.ready=true;
}
void start().catch(error=>{api.error=error.message;});
