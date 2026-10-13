import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {EnginePlayer,type PlayerRef} from './player';

/** The engine's player as a React element: a canvas filling its box, the same handle the rest of the app drives (seek,
 * play, pause, mute, fullscreen, frame events). Coded scenes play in a layer above it, and whatever lies over a scene is
 * drawn on a transparent canvas on top. Clicking the picture plays or pauses, as before. */
export const EngineView=forwardRef<PlayerRef|null,{timeline:TimelineDocument;footage:FootageIndex;frame?:number;style?:React.CSSProperties;clickToPlay?:boolean;onReady?:(player:PlayerRef)=>void}>(function EngineView(p,ref){
 const canvas=useRef<HTMLCanvasElement>(null),scenes=useRef<HTMLDivElement>(null),overlay=useRef<HTMLCanvasElement>(null),[player,setPlayer]=useState<EnginePlayer|null>(null),[error,setError]=useState<string>();
 useEffect(()=>{if(!canvas.current||!scenes.current||!overlay.current)return;try{const made=new EnginePlayer(canvas.current,{scenes:scenes.current,overlay:overlay.current});setPlayer(made);p.onReady?.(made);return()=>made.destroy();}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{player?.setProject(p.timeline,p.footage);},[player,p.timeline,p.footage]);
 useEffect(()=>{if(player&&p.frame!==undefined)player.seekTo(p.frame);},[player,p.frame]);
 useImperativeHandle(ref,()=>player as PlayerRef,[player]);
 if(error)return <div className="preview-error" role="alert">Playback unavailable: {error}</div>;
 const fill:React.CSSProperties={position:'absolute',inset:0,display:'block',width:'100%',height:'100%'};
 return <div style={{position:'relative',width:'100%',height:'100%',overflow:'hidden',...p.style}} onClick={()=>{if(p.clickToPlay)player?.toggle();}}>
  <canvas ref={canvas} style={fill}/>
  <div ref={scenes} style={{position:'absolute',inset:0,pointerEvents:'none'}}/>
  <canvas ref={overlay} style={{...fill,pointerEvents:'none',visibility:'hidden'}}/>
 </div>;
});
export type {PlayerRef};
