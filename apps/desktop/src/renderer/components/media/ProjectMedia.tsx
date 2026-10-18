import React,{useState} from 'react';
import {Search,Plus,Film,Music2,Check,Sparkles,Upload,AlertCircle,LoaderCircle} from 'lucide-react';
import type {Asset} from '@dream/footage';
import type {ProjectState} from '@dream/project-db';
import type {CommandFn} from '../../hooks/useProjectSession';

type Filter='all'|'video'|'audio'|'image'|'made';
// What Gumbo made (scenes, music and sounds it wrote) is its own group, apart from what the user brought.
const groupOf=(a:Asset):Exclude<Filter,'all'>=>a.scene||a.creation||a.generated?'made':a.kind==='audio'?'audio':a.kind==='image'?'image':'video';
const filters:{id:Filter;label:string}[]=[{id:'all',label:'All'},{id:'video',label:'Video'},{id:'audio',label:'Audio'},{id:'image',label:'Images'},{id:'made',label:'Made by Gumbo'}];
// A sound shorter than a second reads in tenths, so a 0.2 s click does not show as 0:00.
const clock=(sec:number)=>{if(sec<1)return sec.toFixed(1)+'s';const s=Math.round(sec);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

/** The project's media as a bin, like CapCut's: search, kinds, pictures with their length, a muted preview on hover. Click
 * to send a piece with the next message; drag it onto the timeline; drop files from the computer here to import them. In
 * the editor layout (onAdd) a card's + puts it on the timeline at the playhead, as OpenCut's media panel does. */
export function ProjectMedia(p:{project:ProjectState;selected:string[];onSelect:(ids:string[])=>void;onImport:()=>void;onImportFiles?:(paths:string[])=>void;command:CommandFn;onAdd?:(assetId:string)=>void}){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<Filter>('all'),[dropping,setDropping]=useState(false);
 const assets=p.project.footage.assets.filter(a=>a.generated?.role!=='stem'),count=(f:Filter)=>f==='all'?assets.length:assets.filter(a=>groupOf(a)===f).length;
 const shown=assets.filter(a=>(filter==='all'||groupOf(a)===filter)&&a.filename.toLowerCase().includes(query.trim().toLowerCase()));
 const toggle=(id:string)=>p.onSelect(p.selected.includes(id)?p.selected.filter(x=>x!==id):[...p.selected,id]);
 const files=(e:React.DragEvent)=>[...e.dataTransfer.types].includes('Files');
 return <div className={'project-media'+(dropping?' dropping':'')} onDragOver={e=>{if(files(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';setDropping(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropping(false);}} onDrop={e=>{if(!files(e))return;e.preventDefault();setDropping(false);const paths=[...e.dataTransfer.files].map(file=>window.dream.mediaPath(file)).filter(Boolean);if(paths.length)p.onImportFiles?.(paths);}}>
  <div className="media-toolbar"><label className="media-search"><Search size={14}/><input aria-label="Search media" placeholder="Search media" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="media-import" onClick={p.onImport}><Plus size={14}/>Import</button></div>
  {assets.length>0&&<div className="media-filters">{filters.filter(f=>f.id==='all'||count(f.id)>0).map(f=><button key={f.id} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.label}<small>{count(f.id)}</small></button>)}</div>}
  <div className="asset-grid">{shown.map(a=><AssetCard key={a.id} asset={a} project={p.project} selected={p.selected.includes(a.id)} onToggle={()=>toggle(a.id)} command={p.command} onAdd={p.onAdd&&(()=>p.onAdd!(a.id))}/>)}</div>
  {!assets.length&&<button className="media-empty" onClick={p.onImport}><Upload size={22}/><strong>Drop videos, images or audio here</strong><small>or click to import. Files are copied into this project.</small></button>}
  {assets.length>0&&!shown.length&&<p className="media-none">Nothing matches{query.trim()?` “${query.trim()}”`:''}.</p>}
  {p.selected.length>0&&<div className="media-selection"><span><strong>{p.selected.length} selected</strong> · sent with your next message</span><button onClick={()=>p.onSelect([])}>Clear</button></div>}
  {dropping&&<div className="media-drop" aria-hidden="true"><Upload size={22}/>Drop to import</div>}
 </div>;
}

function AssetCard({asset:a,project,selected,onToggle,command,onAdd}:{asset:Asset;project:ProjectState;selected:boolean;onToggle:()=>void;command:CommandFn;onAdd?:()=>void}){
 const [hover,setHover]=useState(false),group=groupOf(a),preview=hover&&a.kind==='video'&&!a.scene&&!a.missing&&(a.playback?.ready||a.status==='ready');
 const visual=a.scene?<span className="asset-graphic"><Sparkles size={18}/></span>
  :a.thumbnailPath||a.kind==='image'?<img src={'dream-media://'+a.id+'/'+(a.thumbnailPath?'thumbnail':'original')} alt="" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden';}}/>
  :a.kind==='audio'&&a.waveform?.length?<svg className="asset-wave" viewBox="0 0 100 24" preserveAspectRatio="none">{a.waveform.slice(0,100).map((v,n,all)=><line key={n} x1={n/all.length*100} x2={n/all.length*100} y1={12-v*11} y2={12+v*11}/>)}</svg>
  :<span className="asset-icon">{a.kind==='audio'?<Music2 size={18}/>:<Film size={18}/>}</span>;
 return <article className={`asset-card ${group} kind-${a.kind}${selected?' selected':''}${a.missing?' missing':''}`} draggable title="Click to send with your next message, or drag onto the timeline" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onDragStart={e=>{e.dataTransfer.setData('application/x-dream-asset',a.id);e.dataTransfer.effectAllowed='copy';}}>
  <button className="asset-select" aria-pressed={selected} aria-label={a.filename} onClick={onToggle}>
   <div className="asset-image">{visual}{preview&&<video src={`dream-media://${a.id}/preview`} muted autoPlay loop playsInline/>}
    {a.kind!=='image'&&a.durationSec>0&&<span className="asset-length">{clock(a.durationSec)}</span>}
    {group==='made'&&!a.scene&&<span className="asset-made" title="Made by Gumbo"><Sparkles size={10}/></span>}
    <i className="asset-check">{selected&&<Check size={11} strokeWidth={3}/>}</i>
   </div>
   <strong>{a.filename}</strong>
  </button>
  {onAdd&&<button type="button" className="asset-add" aria-label={'Add '+a.filename+' to the timeline'} title="Add to the timeline at the playhead" onClick={onAdd}><Plus size={13}/></button>}
  <AssetState asset={a} project={project} command={command}/>
 </article>;
}

/** Only what needs attention: preparing, transcribing, a failure to retry, a missing source to relink. Ready says nothing. */
function AssetState({asset:a,project,command}:{asset:Asset;project:ProjectState;command:CommandFn}){
 if(a.missing)return <div className="asset-state warn"><AlertCircle size={11}/>Source missing<button onClick={async()=>{const paths=await window.dream.pickMedia();if(paths[0])await command({type:'relink',assetId:a.id,path:paths[0]});}}>Relink</button></div>;
 if(a.status==='failed')return <div className="asset-state warn"><AlertCircle size={11}/>Couldn’t prepare<button onClick={()=>command({type:'retry',assetId:a.id,step:'analysis'})}>Retry</button></div>;
 if(!(a.playback?.ready||a.status==='ready'))return <div className="asset-state"><LoaderCircle size={11} className="spin"/>Preparing…</div>;
 const speech=a.hasAudio?project.jobs.find(j=>j.assetId===a.id&&j.step==='transcription'):undefined;
 if(speech&&(speech.status==='running'||speech.status==='queued'))return <div className="asset-state"><LoaderCircle size={11} className="spin"/>Transcribing{speech.percent?` ${Math.round(speech.percent)}%`:'…'}</div>;
 if(speech&&speech.status!=='complete')return <div className="asset-state warn" title={speech.error??undefined}><AlertCircle size={11}/>Speech {speech.status==='interrupted'?'paused':'unavailable'}<button onClick={()=>command({type:'retry',assetId:a.id,step:'transcription'})}>Retry</button></div>;
 return null;
}
