import React from 'react';
import {Audio,useCurrentFrame,useVideoConfig} from 'remotion';
import {secondsToSamples,type ResolvedWord} from '@dream/timeline';
import {envelope,type AudioSegment} from './audio-manifest';
export function AudioTrack({segment,src,words}:{segment:AudioSegment;src:string;words:ResolvedWord[]}){
 const frame=useCurrentFrame(),{fps}=useVideoConfig();
 const sample=segment.startSample+secondsToSamples(frame/fps);
 const speech=words.some(w=>secondsToSamples(w.start)<=sample&&secondsToSamples(w.end)>sample);
 return <Audio src={src} trimBefore={Math.round(segment.sourceStartSample/48000*fps)} playbackRate={segment.speed} volume={envelope(segment,sample,speech)} onError={error=>{console.error('Dream audio playback failed',segment.assetId,error);window.dispatchEvent(new CustomEvent('dream-audio-error',{detail:{assetId:segment.assetId,message:typeof error==='string'?error:(error as Error).message}}));}}/>;
}
