import {useCurrentFrame,useVideoConfig} from 'remotion';
import {sceneConfig} from '../config';

/** Beat times (seconds) of a music output this scene lists, for cutting and pulsing on the beat. */
export function useBeats(musicId:string){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),beats=sceneConfig().beats?.[musicId]??[],now=frame/fps;
 let index=-1;for(let i=0;i<beats.length&&beats[i]<=now;i++)index=i;
 const since=index<0?Infinity:now-beats[index];
 return{beats,index,sinceBeat:since,
  /** 1 on the beat, decaying toward 0 over `decay` seconds. */
  pulse:(decay=.25)=>Number.isFinite(since)?Math.exp(-since/Math.max(.01,decay)):0,
  isOnBeat:(toleranceFrames=1)=>Number.isFinite(since)&&since*fps<=toleranceFrames};
}
