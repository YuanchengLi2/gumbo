import React from 'react';
import {Img,useCurrentFrame,useVideoConfig} from 'remotion';
import {sequenceFrame} from '@dream/timeline';
import type {Asset} from '@dream/footage';

/** Preview and export consume the same captured pixels; generated code never runs here. */
export function GeneratedVisual({asset,src,sourceIn=0,speed=1,style}:{asset:Asset;src:string;sourceIn?:number;speed?:number;style?:React.CSSProperties}){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),sequence=asset.sequence!;
 const at=sequenceFrame(sourceIn+Math.max(0,frame)/fps*speed,sequence.fps,sequence.frameCount),url=new URL(src);url.searchParams.set('frame',String(at));
 return <Img src={url.toString()} style={{width:'100%',height:'100%',objectFit:'contain',...style}}/>;
}
