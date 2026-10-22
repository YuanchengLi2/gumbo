import React,{useRef,useState} from 'react';
import {MEDIA} from '@dream/config';
import {Film,Image as ImageIcon,Music2,Sparkles,Type,X} from 'lucide-react';
import type {Asset} from '@dream/footage';
import {ScenePeek} from '../chat/ScenePeek';
import {useVideoFrame} from '../../manual/Filmstrip';

const clock=(sec:number)=>{const s=Math.max(0,Math.round(sec));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export type TileKind='scene'|'video'|'image'|'audio'|'text';
// Without an asset (a file path not imported yet) the extension decides the icon.
const guess=(name?:string):TileKind=>/\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(name??'')?'audio':/\.(png|jpe?g|webp|heic|heif|avif|gif|tiff?)$/i.test(name??'')?'image':/\.(mp4|mov|webm|mkv|m4v|avi|mts|m2ts|3gp|mpe?g|wmv)$/i.test(name??'')?'video':'text';
export const tileKind=(asset?:Asset):TileKind=>!asset?'text':asset.scene?'scene':asset.kind==='audio'?'audio':asset.kind==='image'?'image':'video';
const icons={scene:Sparkles,video:Film,image:ImageIcon,audio:Music2,text:Type};

/** What a selected or attached piece of media looks like everywhere in chat: its kind, a picture of it (the exact frame at
 * a clip's in point), a short muted preview on hover, and its length. Scenes run live; audio shows its waveform. */
export function MediaTile({asset,label,srcIn,srcOut,size='chip',onRemove}:{asset?:Asset;label?:string;srcIn?:number;srcOut?:number;size?:'chip'|'card';onRemove?:()=>void}){
 const kind=asset?tileKind(asset):guess(label),Icon=icons[kind],video=useRef<HTMLVideoElement>(null),start=srcIn??0,end=srcOut??asset?.durationSec??0,name=label??asset?.filename??'Media';
 // The frame at the in point is a picture from the shared decoder; the video (a decoder of its own) is there only while
 // hovered, playing over it. A video that cannot be decoded here, or a sequence, keeps the video element throughout.
 const framed=kind==='video'&&!!asset&&(srcIn!==undefined||!asset.thumbnailPath),still=useVideoFrame(framed&&!asset!.sequence?asset:undefined,start),always=framed&&(still.failed||!!asset!.sequence),[hovered,setHovered]=useState(false);
 const play=()=>{if(!always){setHovered(true);return;}const node=video.current;if(!node)return;node.currentTime=start;void node.play().catch(()=>{});};
 const stop=()=>{if(!always){setHovered(false);return;}const node=video.current;if(!node)return;node.pause();node.currentTime=start;};
 const clip=(over:boolean)=><video ref={video} src={`${MEDIA}${asset!.id}/preview#t=${start.toFixed(2)}`} muted playsInline preload="metadata" autoPlay={over} style={over?{position:'absolute',inset:0}:undefined} onTimeUpdate={e=>{if(end&&e.currentTarget.currentTime>=end)e.currentTarget.currentTime=start;}}/>;
 const visual=kind==='scene'&&asset?<ScenePeek asset={asset}/>
  :kind==='video'&&asset?(framed?(always?clip(false):<>{still.url&&<img src={still.url} alt=""/>}{hovered&&clip(true)}</>):<img src={`${MEDIA}${asset.id}/thumbnail`} alt="" loading="lazy"/>)
  :kind==='image'&&asset?<img src={`${MEDIA}${asset.id}/${asset.thumbnailPath?'thumbnail':'original'}`} alt="" loading="lazy"/>
  :kind==='audio'&&asset?.waveform?.length?<svg className="media-tile-wave" viewBox="0 0 100 24" preserveAspectRatio="none">{asset.waveform.slice(0,100).map((v,n,all)=><line key={n} x1={n/all.length*100} x2={n/all.length*100} y1={12-v*11} y2={12+v*11}/>)}</svg>
  :<span className="media-tile-icon"><Icon size={size==='card'?20:14}/></span>;
 const length=kind==='text'?undefined:srcIn!==undefined&&srcOut!==undefined?srcOut-srcIn:asset?.durationSec;
 return <span className={`media-tile ${size} ${kind}`} title={name} onMouseEnter={kind==='video'?play:undefined} onMouseLeave={kind==='video'?stop:undefined}>
  <span className="media-tile-visual">{visual}{!!length&&kind!=='image'&&<small className="media-tile-length">{clock(length)}</small>}</span>
  <span className="media-tile-label"><Icon size={11}/><span>{name}</span></span>
  {onRemove&&<button type="button" aria-label={'Remove '+name} onClick={onRemove}><X size={11}/></button>}
 </span>;
}
