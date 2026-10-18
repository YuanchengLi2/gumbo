import {usePlayhead} from '../../store/playhead';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {EngineView,type PlayerRef} from '../../engine/EngineView';
import {resolve,canvasPresets,canvasRatio,type TimelineDocument} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import {Play,Pause,Maximize,Minimize,Film,Volume2,VolumeX} from 'lucide-react';
import {useEditor} from '../../store/editor';
import {GumboMark} from '../home/HomeScreen';
import type {CommandFn} from '../../hooks/useProjectSession';
import {sameProps} from '../../memo';

/** The time and scrubber follow the player frame by frame on their own, so playing re-renders only them (see playhead.ts). */
function Live({format}:{format:(frame:number)=>string}){return <>{format(usePlayhead(s=>s.frame))}</>;}
function LiveScrubber({duration,onSeek}:{duration:number;onSeek:(frame:number)=>void}){const frame=usePlayhead(s=>s.frame);
 return <input className="scrubber" aria-label="Preview position" type="range" min={0} max={duration-1} value={Math.min(frame,duration-1)} onChange={e=>onSeek(Number(e.target.value))}/>;}
type Props={project:ProjectState;timeline?:TimelineDocument;player:React.RefObject<PlayerRef|null>;frame:number;playing:boolean;onFrame:(frame:number)=>void;onPlaying:(value:boolean)=>void;command:CommandFn;working?:boolean;manual?:boolean;onImport?:()=>void;
 /** What Gumbo is doing, shown while it edits an empty canvas. */
 status?:string;
 /** Drawn over the picture: the editor's selection handles. */
 overlay?:React.ReactNode};
function PlayerView(p:Props){
 const t=p.timeline??p.project.timeline,r=useMemo(()=>resolve(t,p.project.footage),[t,p.project.footage]);
 const [engine,setEngine]=useState<PlayerRef|null>(null);
 const viewport=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0}),[muted,setMuted]=useState(false),[full,setFull]=useState(false);
 // Fullscreen fills the window with the picture at its own shape, and puts the window itself in fullscreen. Esc, the
 // button or leaving the window's fullscreen (F11) ends it.
 const fullscreen=(on:boolean)=>{setFull(on);void window.dream.setFullScreen(on);};
 useEffect(()=>{if(!full)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();fullscreen(false);}};window.addEventListener('keydown',key);
  const off=window.dream.onEvent(event=>{if(event.type==='window.fullscreen'&&!(event.payload as {on?:boolean})?.on)setFull(false);});return()=>{window.removeEventListener('keydown',key);off();};},[full]);
 const duration=Math.max(1,r.durationInFrames),seek=(n:number)=>{const frame=Math.max(0,Math.min(duration-1,n));p.player.current?.seekTo(frame);p.onFrame(frame);};
 useLayoutEffect(()=>{
  const node=viewport.current;if(!node)return;
  const fit=()=>{const ratio=t.settings.width/t.settings.height,width=Math.max(0,Math.min(node.clientWidth,node.clientHeight*ratio));setSize({width,height:width/ratio});};
  fit();const observer=new ResizeObserver(fit);observer.observe(node);return()=>observer.disconnect();
 },[t.settings.width,t.settings.height]);
 useEffect(()=>{
  const player=engine;if(!player)return;
  const frame=(e:any)=>p.onFrame(e.detail.frame),play=()=>p.onPlaying(true),pause=()=>p.onPlaying(false),mute=()=>setMuted(player.isMuted());
  player.addEventListener('frameupdate',frame);player.addEventListener('play',play);player.addEventListener('pause',pause);player.addEventListener('mutechange',mute);
  player.seekTo(Math.max(0,Math.min(duration-1,p.frame)));mute();
  return()=>{player.removeEventListener('frameupdate',frame);player.removeEventListener('play',play);player.removeEventListener('pause',pause);player.removeEventListener('mutechange',mute);};
 },[engine,p.project.meta.id,!!r.durationInFrames]);
 useEffect(()=>{if(p.frame>=duration)seek(duration-1);},[duration]);
 useEffect(()=>{const handler=(event:Event)=>{const detail=(event as CustomEvent).detail,asset=p.project.footage.assets.find(a=>a.id===detail.assetId);useEditor.getState().setError('Audio could not play for '+(asset?.filename??'this clip')+'. '+(detail.message??'Retry audio preparation in Media.'));};window.addEventListener('dream-audio-error',handler);return()=>window.removeEventListener('dream-audio-error',handler);},[p.project.footage]);

 const clock=(frames:number)=>{const sec=Math.floor(frames/t.settings.fps);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');};
 // Frame-accurate, as OpenCut shows it: hours, minutes, seconds and frames.
 const timecode=(frames:number)=>{const fps=t.settings.fps,sec=Math.floor(frames/fps),two=(n:number)=>String(n).padStart(2,'0');return two(Math.floor(sec/3600))+':'+two(Math.floor(sec/60)%60)+':'+two(sec%60)+':'+two(frames%fps);};
 return <section className={'project-player '+(p.manual?'manual-player':'')+(full?' preview-fullscreen':'')}>
  <div className="preview-viewport" ref={viewport}>
   <div className="preview-frame" style={{width:size.width||'100%',height:size.height||'100%',aspectRatio:t.settings.width+'/'+t.settings.height}}>
    {r.durationInFrames>0?<><EngineView ref={p.player} timeline={t} footage={p.project.footage} clickToPlay={!p.overlay} onReady={setEngine}/>{p.overlay}</>:p.working?null:<div className="preview-empty"><Film size={30}/><h3>Your canvas is ready</h3><p>Add media or describe the video you want to make.</p></div>}
    {/* One state at a time: while Gumbo works on an empty edit, only "Gumbo is editing" shows (it has no background, so the
        empty canvas's message showed through it). */}
    {p.working&&!r.durationInFrames&&<div className="preview-working" role="status" aria-label="Gumbo is editing"><GumboMark/><strong>Gumbo is editing</strong><span className="editing-status">{p.status}</span></div>}
   </div>
   {full&&<button className="icon-button fullscreen-exit" title="Exit fullscreen (Esc)" aria-label="Exit fullscreen" onClick={()=>fullscreen(false)}><Minimize size={18}/></button>}
  </div>
  <div className="transport">
   {/* The editor's transport is OpenCut's: the timecode, then play in the middle; its timeline is the scrubber. Gumbo's
       layout keeps play, the time and a scrubber. */}
   {p.manual?<><span className="time-current timecode"><Live format={timecode}/> <span>/ {timecode(duration)}</span></span><span className="transport-gap"/><button className="icon-button" aria-label={p.playing?'Pause':'Play'} disabled={!r.durationInFrames} onClick={()=>{try{p.player.current?.toggle();}catch(error){useEditor.getState().setError('Preview playback failed: '+(error as Error).message);}}}>{p.playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}</button><span className="transport-gap"/></>
    :<><button className="icon-button" aria-label={p.playing?'Pause':'Play'} disabled={!r.durationInFrames} onClick={()=>{try{p.player.current?.toggle();}catch(error){useEditor.getState().setError('Preview playback failed: '+(error as Error).message);}}}>{p.playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}</button><span className="time-current"><Live format={clock}/> <span>/ {clock(duration)}</span></span>
   <LiveScrubber duration={duration} onSeek={seek}/></>}
   <button className="icon-button" aria-label={muted?'Unmute preview':'Mute preview'} aria-pressed={muted} onClick={()=>{const player=p.player.current;if(player?.isMuted())player.unmute();else player?.mute();}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>
   <select className="ratio-picker" aria-label="Canvas ratio" disabled={p.working} value={canvasRatio(t.settings.width,t.settings.height)} onChange={e=>{const preset=canvasPresets.find(i=>i.ratio===e.target.value)!;void p.command({type:'apply',requestId:crypto.randomUUID(),expectedVersionId:p.project.versionId,label:'Change canvas ratio',ops:[{type:'set_project_settings',settings:{width:preset.width,height:preset.height},reason:'Change canvas ratio'}]});}}>
    {!canvasPresets.some(i=>i.ratio===canvasRatio(t.settings.width,t.settings.height))&&<option>{canvasRatio(t.settings.width,t.settings.height)}</option>}{canvasPresets.map(i=><option key={i.ratio}>{i.ratio}</option>)}
   </select>
   <button className="icon-button" title="Fullscreen preview" onClick={()=>fullscreen(true)}><Maximize size={18}/></button>
  </div>
 </section>;
}
/** Draws again only when the edit or its own props change, not for each word Gumbo streams. */
export const ProjectPlayer=React.memo(PlayerView,sameProps(['timeline','footage','versionId','meta']));
