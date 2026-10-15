import React,{useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {useCurrentFrame,useVideoConfig} from 'remotion';
import {track} from '../pending';
import {live,subscribeLive} from '../live';

type Props=React.VideoHTMLAttributes<HTMLVideoElement>&{src:string;startFrom?:number;trimBefore?:number;playbackRate?:number;volume?:number;muted?:boolean;loop?:boolean};

/** A video that shows exactly the frame for the current scene time. startFrom/trimBefore are in frames (Remotion
 * semantics). Scenes are silent: sound belongs on the timeline. */
export function SourceVideo({src,startFrom,trimBefore,playbackRate=1,volume:_volume,muted:_muted,loop,style,...rest}:Props){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),ref=useRef<HTMLVideoElement>(null),playing=useSyncExternalStore(subscribeLive,()=>live.playing);
 const offset=(trimBefore??startFrom??0)/fps,time=offset+frame/fps*playbackRate;
 useLayoutEffect(()=>{
  const video=ref.current;if(!video)return;
  // Playing live in the preview: the video plays at its rate and is only put back when it drifts a third of a second,
  // since seeking to every frame (decoding from the last keyframe each time) let a scene draw a few frames a second.
  if(playing){
   if(video.readyState<1)return;let target=time;if(loop&&video.duration>0)target%=video.duration;
   if(video.playbackRate!==playbackRate)video.playbackRate=playbackRate;
   if(!video.seeking&&Math.abs(video.currentTime-target)>.33)video.currentTime=target;
   if(video.paused)void video.play().catch(()=>{});
   return;
  }
  if(!video.paused)video.pause();
  track(new Promise<void>(resolve=>{
   const finish=()=>resolve();video.addEventListener('error',finish,{once:true});
   const seek=()=>{let target=time;if(loop&&video.duration>0)target%=video.duration;else if(video.duration>0)target=Math.min(target,Math.max(0,video.duration-1/fps));
    if(Math.abs(video.currentTime-target)<1/(fps*4)&&!video.seeking&&video.readyState>=2){resolve();return;}
    video.addEventListener('seeked',()=>{if(video.readyState>=2)resolve();else video.addEventListener('loadeddata',finish,{once:true});},{once:true});video.currentTime=target;};
   if(video.readyState>=1)seek();else video.addEventListener('loadedmetadata',seek,{once:true});
  }));
 },[time,src,playing]);
 return <video ref={ref} src={src} muted playsInline preload="auto" style={{objectFit:'cover',...style}} {...rest}/>;
}
