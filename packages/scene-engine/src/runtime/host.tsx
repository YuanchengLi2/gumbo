import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Thumbnail} from '@remotion/player';
import {readConfig} from './config';
import {installDeterminism} from './determinism';
import {installBridge,post} from './bridge';
import type {Registry} from './registry';
import type {HostConfig} from '../host-html';

const report=(error:unknown,fatal=false)=>post({error:String((error as Error)?.message??error),stack:(error as Error)?.stack,fatal});

/** Mounts the scene's default export as a Remotion composition of one frame at a time (Remotion's Thumbnail), so
 * useCurrentFrame, Sequence, spring and the other Remotion APIs behave as in a normal Remotion project. */
export function mount(registry:Registry){
 addEventListener('error',event=>report(event.error??event.message,true));
 addEventListener('unhandledrejection',event=>report(event.reason,true));
 let config:HostConfig;try{config=readConfig();}catch(error){report(error,true);return;}
 installDeterminism(config.revisionId);
 let Component:any;
 try{const scene=registry.require('scene');Component=scene?.default??scene;if(typeof Component!=='function'&&typeof Component?.$$typeof!=='symbol')throw new Error('The scene file must export a default React component (export default function Scene() {...}).');}
 catch(error){report(error,true);return;}
 let show:(frame:number)=>void=()=>{};
 const fallback=({error}:{error:Error})=>{report(error,true);return null;};
 function Host(){
  const [frame,setFrame]=useState(0);show=setFrame;
  return <Thumbnail component={Component} compositionWidth={config.width} compositionHeight={config.height} durationInFrames={config.durationInFrames} fps={config.fps} frameToDisplay={frame} inputProps={(config.props??{}) as any} style={{width:config.width,height:config.height}} errorFallback={fallback as any}/>;
 }
 const root=createRoot(document.getElementById('root')!);
 flushSync(()=>root.render(<Host/>));
 installBridge(registry,frame=>flushSync(()=>show(frame)));
 post({ready:true});
}
