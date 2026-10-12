import {editingActivity,editingTask} from '../../editing-language';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {TimelineComposition} from '@dream/composition';
import {resolve,canvasPresets,canvasRatio,type TimelineDocument} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import {Play,Pause,Maximize,Film,Volume2,VolumeX} from 'lucide-react';
import {useEditor} from '../../store/editor';
import {DreamMark} from '../home/HomeScreen';
import type {CommandFn} from '../../hooks/useProjectSession';

type Props={project:ProjectState;timeline?:TimelineDocument;player:React.RefObject<PlayerRef|null>;frame:number;playing:boolean;onFrame:(frame:number)=>void;onPlaying:(value:boolean)=>void;command:CommandFn;working?:boolean;manual?:boolean;onImport?:()=>void};
export function ProjectPlayer(p:Props){
 const t=p.timeline??p.project.timeline,r=useMemo(()=>resolve(t,p.project.footage),[t,p.project.footage]);
 const inputProps=useMemo(()=>({timeline:t,footage:p.project.footage,
  media:Object.fromEntries(p.project.footage.assets.map(a=>[a.id,'dream-media://'+a.id+'/preview?revision='+encodeURIComponent(a.proxyPath?'proxy':'original')])),
  audioMedia:Object.fromEntries(p.project.footage.assets.filter(a=>a.hasAudio).map(a=>[a.id,'dream-media://'+a.id+'/audio?revision='+encodeURIComponent(a.audioPath?'normalized':a.playback?.audio??'original')]))
 }),[t,p.project.footage]);
 const viewport=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0}),[muted,setMuted]=useState(false);
 const duration=Math.max(1,r.durationInFrames),seek=(n:number)=>{const frame=Math.max(0,Math.min(duration-1,n));p.player.current?.seekTo(frame);p.onFrame(frame);};
 useLayoutEffect(()=>{
  const node=viewport.current;if(!node)return;
  const fit=()=>{const ratio=t.settings.width/t.settings.height,width=Math.max(0,Math.min(node.clientWidth,node.clientHeight*ratio));setSize({width,height:width/ratio});};
  fit();const observer=new ResizeObserver(fit);observer.observe(node);return()=>observer.disconnect();
 },[t.settings.width,t.settings.height]);
 useEffect(()=>{
  const player=p.player.current;if(!player)return;
  const frame=(e:any)=>p.onFrame(e.detail.frame),play=()=>p.onPlaying(true),pause=()=>p.onPlaying(false),mute=()=>setMuted(player.isMuted());
  player.addEventListener('frameupdate',frame);player.addEventListener('play',play);player.addEventListener('pause',pause);player.addEventListener('mutechange',mute);
  player.seekTo(Math.max(0,Math.min(duration-1,p.frame)));mute();
  return()=>{player.removeEventListener('frameupdate',frame);player.removeEventListener('play',play);player.removeEventListener('pause',pause);player.removeEventListener('mutechange',mute);};
 },[p.project.meta.id,!!r.durationInFrames]);
 useEffect(()=>{if(p.frame>=duration)seek(duration-1);},[duration]);
 useEffect(()=>{const handler=(event:Event)=>{const detail=(event as CustomEvent).detail,asset=p.project.footage.assets.find(a=>a.id===detail.assetId);useEditor.getState().setError('Audio could not play for '+(asset?.filename??'this clip')+'. '+(detail.message??'Retry audio preparation in Media.'));};window.addEventListener('dream-audio-error',handler);return()=>window.removeEventListener('dream-audio-error',handler);},[p.project.footage]);

 const clock=(frames:number)=>{const sec=Math.floor(frames/t.settings.fps);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');};
 const currentStep=p.project.experience?.steps?.findLast(step=>step.status==='running'),currentAction=p.project.experience?.activity?.events?.findLast(event=>event.kind==='action'&&event.status==='running');
 return <section className={'project-player '+(p.manual?'manual-player':'')}>
  <div className="preview-viewport" ref={viewport}>
   <div className="preview-frame" style={{width:size.width||'100%',height:size.height||'100%',aspectRatio:t.settings.width+'/'+t.settings.height}}>
    {r.durationInFrames>0?<Player ref={p.player} component={TimelineComposition} inputProps={inputProps} durationInFrames={duration} compositionWidth={t.settings.width} compositionHeight={t.settings.height} fps={t.settings.fps} controls={false} clickToPlay numberOfSharedAudioTags={16} errorFallback={({error})=><div className="preview-error" role="alert">Playback unavailable: {error.message}</div>} style={{width:'100%',height:'100%'}}/>:<div className="preview-empty"><Film size={30}/><h3>Your canvas is ready</h3><p>Add media or describe the video you want to make.</p></div>}
    {p.working&&!r.durationInFrames&&<div className="preview-working" role="status" aria-label="Figjam is editing"><div className="editing-animation"><div className="editing-orbit"/><DreamMark/></div><strong>Figjam is editing</strong><span className="editing-status">{currentAction?editingActivity(currentAction):currentStep?editingTask(currentStep.label):'Putting your ideas in motion'}</span><div className="editing-pulse"><i/><i/><i/></div></div>}
   </div>
  </div>
  <div className="transport">
   <button className="icon-button" aria-label={p.playing?'Pause':'Play'} disabled={!r.durationInFrames} onClick={()=>{try{p.player.current?.toggle();}catch(error){useEditor.getState().setError('Preview playback failed: '+(error as Error).message);}}}>{p.playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}</button>
   <span className="time-current">{clock(p.frame)} <span>/ {clock(duration)}</span></span>
   <input className="scrubber" aria-label="Preview position" type="range" min={0} max={duration-1} value={Math.min(p.frame,duration-1)} onChange={e=>seek(Number(e.target.value))}/>
   <button className="icon-button" aria-label={muted?'Unmute preview':'Mute preview'} aria-pressed={muted} onClick={()=>{const player=p.player.current;if(player?.isMuted())player.unmute();else player?.mute();}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>
   <select className="ratio-picker" aria-label="Canvas ratio" disabled={p.working} value={canvasRatio(t.settings.width,t.settings.height)} onChange={e=>{const preset=canvasPresets.find(i=>i.ratio===e.target.value)!;void p.command({type:'apply',requestId:crypto.randomUUID(),expectedVersionId:p.project.versionId,label:'Change canvas ratio',ops:[{type:'set_project_settings',settings:{width:preset.width,height:preset.height},reason:'Change canvas ratio'}]});}}>
    {!canvasPresets.some(i=>i.ratio===canvasRatio(t.settings.width,t.settings.height))&&<option>{canvasRatio(t.settings.width,t.settings.height)}</option>}{canvasPresets.map(i=><option key={i.ratio}>{i.ratio}</option>)}
   </select>
   <button className="icon-button" title="Fullscreen preview" onClick={()=>p.player.current?.requestFullscreen()}><Maximize size={18}/></button>
  </div>
 </section>;
}

