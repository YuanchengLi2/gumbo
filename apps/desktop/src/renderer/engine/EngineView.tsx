import React,{forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {EnginePlayer,type PlayerRef} from './player';

/** What a player draws on: the picture's canvas, the layer coded scenes play in, and the transparent canvas over them.
 * They are kept for the app's life and lent to each preview in turn (the player and the export dialog can show at once):
 * a new canvas is a new WebGL context, and building its shaders blocked the window for about a third of a second each
 * time a project opened or the layout changed. */
type Surface={canvas:HTMLCanvasElement;scenes:HTMLDivElement;overlay:HTMLCanvasElement};
const spare:Surface[]=[];
const fill='position:absolute;inset:0;display:block;width:100%;height:100%';
function lend():Surface{
 const kept=spare.pop();if(kept){kept.overlay.style.visibility='hidden';return kept;}
 const canvas=document.createElement('canvas'),scenes=document.createElement('div'),overlay=document.createElement('canvas');
 canvas.style.cssText=fill;scenes.style.cssText='position:absolute;inset:0;pointer-events:none';overlay.style.cssText=fill+';pointer-events:none;visibility:hidden';
 return{canvas,scenes,overlay};
}

/** The engine's player as a React element: a canvas filling its box, the same handle the rest of the app drives (seek,
 * play, pause, mute, fullscreen, frame events). Coded scenes play in a layer above it, and whatever lies over a scene is
 * drawn on a transparent canvas on top. Clicking the picture plays or pauses, as before. */
export const EngineView=forwardRef<PlayerRef|null,{timeline:TimelineDocument;footage:FootageIndex;frame?:number;style?:React.CSSProperties;clickToPlay?:boolean;onReady?:(player:PlayerRef)=>void}>(function EngineView(p,ref){
 const box=useRef<HTMLDivElement>(null),[player,setPlayer]=useState<EnginePlayer|null>(null),[error,setError]=useState<string>();
 useLayoutEffect(()=>{const host=box.current;if(!host)return;const surface=lend();host.append(surface.canvas,surface.scenes,surface.overlay);
  let made:EnginePlayer|undefined;try{made=new EnginePlayer(surface.canvas,{scenes:surface.scenes,overlay:surface.overlay});setPlayer(made);p.onReady?.(made);}catch(e){setError((e as Error).message);}
  return()=>{made?.destroy();surface.canvas.remove();surface.scenes.remove();surface.overlay.remove();if(made)spare.push(surface);};},[]);
 useEffect(()=>{player?.setProject(p.timeline,p.footage);},[player,p.timeline,p.footage]);
 useEffect(()=>{if(player&&p.frame!==undefined)player.seekTo(p.frame);},[player,p.frame]);
 useImperativeHandle(ref,()=>player as PlayerRef,[player]);
 if(error)return <div className="preview-error" role="alert">Playback unavailable: {error}</div>;
 return <div ref={box} style={{position:'relative',width:'100%',height:'100%',overflow:'hidden',...p.style}} onClick={()=>{if(p.clickToPlay)player?.toggle();}}/>;
});
export type {PlayerRef};
