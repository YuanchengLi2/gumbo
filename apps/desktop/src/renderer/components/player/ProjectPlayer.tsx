import {editingActivity,editingTask} from '../../editing-language';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {EngineView,type PlayerRef} from '../../engine/EngineView';
import {resolve,canvasPresets,canvasRatio,type TimelineDocument} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import {Play,Pause,Maximize,Minimize,Film,Volume2,VolumeX} from 'lucide-react';
import {useEditor} from '../../store/editor';
import {GumboMark} from '../home/HomeScreen';
import type {CommandFn} from '../../hooks/useProjectSession';

type Props={project:ProjectState;timeline?:TimelineDocument;player:React.RefObject<PlayerRef|null>;frame:number;playing:boolean;onFrame:(frame:number)=>void;onPlaying:(value:boolean)=>void;command:CommandFn;working?:boolean;manual?:boolean;onImport?:()=>void};
export function ProjectPlayer(p:Props){
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
 const currentStep=p.project.experience?.steps?.findLast(step=>step.status==='running'),currentAction=p.project.experience?.activity?.events?.findLast(event=>event.kind==='action'&&event.status==='running');
 return <section className={'project-player '+(p.manual?'manual-player':'')+(full?' preview-fullscreen':'')}>
  <div className="preview-viewport" ref={viewport}>
   <div className="preview-frame" style={{width:size.width||'100%',height:size.height||'100%',aspectRatio:t.settings.width+'/'+t.settings.height}}>
    {r.durationInFrames>0?<EngineView ref={p.player} timeline={t} footage={p.project.footage} clickToPlay onReady={setEngine}/>:<div className="preview-empty"><Film size={30}/><h3>Your canvas is ready</h3><p>Add media or describe the video you want to make.</p></div>}
    {p.working&&!r.durationInFrames&&<div className="preview-working" role="status" aria-label="Gumbo is editing"><div className="editing-animation"><div className="editing-orbit"/><GumboMark/></div><strong>Gumbo is editing</strong><span className="editing-status">{currentAction?editingActivity(currentAction):currentStep?editingTask(currentStep.label):'Putting your ideas in motion'}</span><div className="editing-pulse"><i/><i/><i/></div></div>}
   </div>
   {full&&<button className="icon-button fullscreen-exit" title="Exit fullscreen (Esc)" aria-label="Exit fullscreen" onClick={()=>fullscreen(false)}><Minimize size={18}/></button>}
  </div>
  <div className="transport">
   <button className="icon-button" aria-label={p.playing?'Pause':'Play'} disabled={!r.durationInFrames} onClick={()=>{try{p.player.current?.toggle();}catch(error){useEditor.getState().setError('Preview playback failed: '+(error as Error).message);}}}>{p.playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}</button>
   <span className="time-current">{clock(p.frame)} <span>/ {clock(duration)}</span></span>
   <input className="scrubber" aria-label="Preview position" type="range" min={0} max={duration-1} value={Math.min(p.frame,duration-1)} onChange={e=>seek(Number(e.target.value))}/>
   <button className="icon-button" aria-label={muted?'Unmute preview':'Mute preview'} aria-pressed={muted} onClick={()=>{const player=p.player.current;if(player?.isMuted())player.unmute();else player?.mute();}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>
   <select className="ratio-picker" aria-label="Canvas ratio" disabled={p.working} value={canvasRatio(t.settings.width,t.settings.height)} onChange={e=>{const preset=canvasPresets.find(i=>i.ratio===e.target.value)!;void p.command({type:'apply',requestId:crypto.randomUUID(),expectedVersionId:p.project.versionId,label:'Change canvas ratio',ops:[{type:'set_project_settings',settings:{width:preset.width,height:preset.height},reason:'Change canvas ratio'}]});}}>
    {!canvasPresets.some(i=>i.ratio===canvasRatio(t.settings.width,t.settings.height))&&<option>{canvasRatio(t.settings.width,t.settings.height)}</option>}{canvasPresets.map(i=><option key={i.ratio}>{i.ratio}</option>)}
   </select>
   <button className="icon-button" title="Fullscreen preview" onClick={()=>fullscreen(true)}><Maximize size={18}/></button>
  </div>
 </section>;
}

