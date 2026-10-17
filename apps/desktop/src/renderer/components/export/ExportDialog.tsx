import React,{useEffect,useRef,useState} from 'react';
import {EngineView,type PlayerRef} from '../../engine/EngineView';
import {resolve} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import type {ExportProgress} from '@dream/contracts';
import {X,FolderOpen,Check,Film,Share2,Play,Pause} from 'lucide-react';

export type ExportChoices={name:string;folder:string;video:boolean;resolution:'source'|'480'|'720'|'1080'|'1440'|'2160';quality:'lower'|'recommended'|'higher';codec:'h264'|'hevc';format:'mp4'|'mov';fps:'source'|24|25|30|50|60;audio:boolean;audioFormat:'mp3'|'wav'|'aac'};
const resolutions=[['480','480p'],['720','720p'],['1080','1080p'],['1440','2K'],['2160','4K']] as const;
const qualities=[['lower','Lower'],['recommended','Recommended'],['higher','Higher']] as const;
// Bits per pixel each frame at each bit rate, as an H.264 encoder at that quality averages on edited footage; HEVC needs
// about 40% less for the same picture.
const bpp={lower:.05,recommended:.1,higher:.16};
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const remembered=():Partial<ExportChoices>=>{try{return JSON.parse(localStorage.getItem('dream-export')??'{}');}catch{return{};}};

/** The export window, laid out as CapCut's: the video on the left, in the export's own shape and playable (play, scrub, the
 * time); the name, folder, video and audio settings on the right; the length and an estimated size beside Export.
 * Progress shows over the video, then where the files went. Playback pauses while exporting, which draws in this window. */
export function ExportDialog(p:{project:ProjectState;frame:number;progress:ExportProgress|null;onClose:()=>void;onExport:(choices:ExportChoices)=>void;onCancel:()=>void;onTimeline:()=>void;onShare:()=>void}){
 const t=p.project.timeline,{width,height,fps}=t.settings,short=Math.min(width,height),duration=resolve(t,p.project.footage).durationSec;
 const [c,setC]=useState<ExportChoices>(()=>({name:p.project.meta.name,folder:p.project.meta.folder.replace(/[\\/]+$/,'')+(p.project.meta.folder.includes('\\')?'\\':'/')+'Exports',video:true,resolution:'source',quality:'recommended',codec:'h264',format:'mp4',fps:'source',audio:false,audioFormat:'mp3',...remembered()}));
 const set=(patch:Partial<ExportChoices>)=>setC(old=>{const next={...old,...patch};try{const {name,folder,...kept}=next;localStorage.setItem('dream-export',JSON.stringify(kept));}catch{}return next;});
 const target=c.resolution==='source'?short:Math.min(short,Number(c.resolution)),outW=Math.round(width*target/short/2)*2,outH=Math.round(height*target/short/2)*2,outFps=c.fps==='source'?fps:c.fps;
 const bytes=(c.video?bpp[c.quality]*(c.codec==='hevc'?.6:1)*outW*outH*outFps*duration/8:0)+(c.audio||c.video?(c.audioFormat==='wav'&&!c.video?1536e3:256e3)*duration/8:0);
 const size=bytes>=1e9?(bytes/1e9).toFixed(1)+' GB':Math.max(1,Math.round(bytes/1e6))+' MB';
 const running=p.progress?.status==='rendering',done=p.progress?.status==='completed',failed=p.progress?.status==='failed'||p.progress?.status==='cancelled';
 // Sizes up to the project's own, which is the last choice (exporting never upscales).
 const sizes:(readonly [ExportChoices['resolution'],string])[]=[...resolutions.filter(([r])=>Number(r)<short),['source',resolutions.find(([r])=>Number(r)===short)?.[1]??`${short}p`]];
 const resolutionValue=c.resolution!=='source'&&Number(c.resolution)<short?c.resolution:'source';
 const total=Math.max(1,Math.round(duration*fps)),[start]=useState(()=>Math.min(Math.max(0,p.frame),total-1)),player=useRef<PlayerRef|null>(null),[at,setAt]=useState(start),[playing,setPlaying]=useState(false);
 useEffect(()=>{if(running)player.current?.pause();},[running]);
 const ready=(made:PlayerRef)=>{player.current=made;made.addEventListener('frameupdate',e=>setAt((e.detail as {frame:number}).frame));made.addEventListener('play',()=>setPlaying(true));made.addEventListener('pause',()=>setPlaying(false));};
 const row=(label:string,control:React.ReactNode)=><label className="export-row"><span>{label}</span>{control}</label>;
 const select=<T extends string|number>(value:T,choices:readonly (readonly [T,string])[],change:(v:T)=>void,disabled=false)=><select value={String(value)} disabled={disabled||running} onChange={e=>change(choices.find(([v])=>String(v)===e.target.value)![0])}>{choices.map(([v,l])=><option key={String(v)} value={String(v)}>{l}</option>)}</select>;
 return <section className="dialog export-dialog" role="dialog" aria-label="Export">
  <header className="export-head"><h2>Export</h2><button className="icon-button" aria-label="Close" onClick={p.onClose}><X size={18}/></button></header>
  <div className="export-body">
   <div className="export-stage"><div className="export-cover" style={{aspectRatio:`${width}/${height}`,width:`min(100%, calc(var(--export-stage-height) * ${width} / ${height}))`}}>
    {duration>0?<EngineView timeline={t} footage={p.project.footage} frame={start} clickToPlay={!running} onReady={ready}/>:<Film size={28}/>}
    {(running||done)&&<div className={'export-cover-state'+(done?' done':'')}>{done?<><span className="export-check"><Check size={22}/></span><strong>Exported</strong></>:<><strong>{Math.round((p.progress?.progress??0)*100)}%</strong><small>{p.progress?.phase??'Exporting'}</small></>}</div>}
   </div>
   {duration>0&&<div className="export-transport" style={{width:`min(100%, max(240px, calc(var(--export-stage-height) * ${width} / ${height})))`}}>
    <button type="button" className="icon-button" aria-label={playing?'Pause':'Play'} disabled={running} onClick={()=>player.current?.toggle()}>{playing?<Pause size={16}/>:<Play size={16}/>}</button>
    <input type="range" aria-label="Position" min={0} max={total-1} value={Math.min(at,total-1)} disabled={running} onChange={e=>{const frame=Number(e.target.value);setAt(frame);player.current?.seekTo(frame);}}/>
    <span className="export-time">{clock(Math.min(at,total-1)/fps)} / {clock(duration)}</span>
   </div>}
   </div>
   <div className="export-form">
    {row('Name',<input value={c.name} disabled={running} onChange={e=>set({name:e.target.value})}/>)}
    {row('Export to',<span className="export-folder" title={c.folder}><span>{c.folder}</span><button type="button" aria-label="Choose folder" disabled={running} onClick={async()=>{const picked=await window.dream.pickExportFolder(c.folder);if(picked)set({folder:picked});}}><FolderOpen size={15}/></button></span>)}
    <div className="export-section"><label className="export-toggle"><input type="checkbox" checked={c.video} disabled={running} onChange={e=>set({video:e.target.checked})}/><strong>Video</strong></label>
     {row('Resolution',select(resolutionValue,sizes,v=>set({resolution:v}),!c.video))}
     {row('Bit rate',select(c.quality,qualities,v=>set({quality:v}),!c.video))}
     {row('Codec',select(c.codec,[['h264','H.264'],['hevc','HEVC']] as const,v=>set({codec:v}),!c.video))}
     {row('Format',select(c.format,[['mp4','mp4'],['mov','mov']] as const,v=>set({format:v}),!c.video))}
     {row('Frame rate',select(String(outFps),([24,25,30,50,60] as const).map(n=>[String(n),`${n}fps`] as const),v=>set({fps:Number(v)===fps?'source':Number(v) as ExportChoices['fps']}),!c.video))}
    </div>
    <div className="export-section"><label className="export-toggle"><input type="checkbox" checked={c.audio} disabled={running} onChange={e=>set({audio:e.target.checked})}/><strong>Audio</strong></label>
     {row('Format',select(c.audioFormat,[['mp3','MP3'],['wav','WAV'],['aac','AAC']] as const,v=>set({audioFormat:v}),!c.audio))}
    </div>
    <button type="button" className="export-xml" disabled={running} onClick={p.onTimeline}>Editable timeline for Premiere or Resolve (XML)</button>
   </div>
  </div>
  <footer className="export-foot">
   {running?<div className="export-bar"><progress max={1} value={p.progress?.progress??0}/></div>:failed?<span className="export-error">{p.progress?.status==='cancelled'?'Export cancelled':p.progress?.error}</span>:done?<span className="export-meta">{(p.progress?.paths??[p.progress?.path]).filter(Boolean).map(path=>path!.split(/[\\/]/).pop()).join(' · ')}</span>:<span className="export-meta">Duration {clock(duration)} <i/> Size about {size}</span>}
   <span className="spacer"/>
   {running?<button className="button secondary" onClick={p.onCancel}>Cancel</button>:done?<>{p.progress?.path?.match(/\.(mp4|mov)$/)&&<button className="button secondary" onClick={p.onShare}><Share2 size={15}/>Share link</button>}<button className="button secondary" onClick={()=>window.dream.reveal(p.progress!.path!)}><FolderOpen size={15}/>Open folder</button><button className="button primary" onClick={p.onClose}>Done</button></>:<><button className="button secondary" onClick={p.onClose}>Cancel</button><button className="button primary" disabled={!c.video&&!c.audio} onClick={()=>p.onExport(c)}>Export</button></>}
  </footer>
 </section>;
}
