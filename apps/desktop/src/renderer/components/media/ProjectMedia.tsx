import React,{useState} from 'react';
import {Search,Upload,Film,Music2,Check} from 'lucide-react';
import type {ProjectState} from '@dream/project-db';
import type {CommandFn} from '../../hooks/useProjectSession';
export function ProjectMedia(p:{project:ProjectState;selected:string[];onSelect:(ids:string[])=>void;onImport:()=>void;command:CommandFn}){
 const [query,setQuery]=useState('');
 return <div className="project-media"><div className="media-heading"><h3>Media</h3><button className="button secondary compact" onClick={p.onImport}><Upload size={14}/> Import</button></div><label className="search"><Search size={15}/><input placeholder="Search your media" value={query} onChange={e=>setQuery(e.target.value)}/></label><p className="media-hint">Select clips to include in your next message. Audio is transcribed in the cloud and cached for future edits.</p>
  <div className="asset-grid">{p.project.footage.assets.filter(a=>a.generated?.role!=='stem'&&a.filename.toLowerCase().includes(query.toLowerCase())).map(a=><article className={'asset-card '+(p.selected.includes(a.id)?'selected':'')} key={a.id} draggable title="Drag onto the timeline to add it" onDragStart={e=>{e.dataTransfer.setData('application/x-dream-asset',a.id);e.dataTransfer.effectAllowed='copy';}}>
   <button className="asset-select" onClick={()=>p.onSelect(p.selected.includes(a.id)?p.selected.filter(id=>id!==a.id):[...p.selected,a.id])}><div className="asset-image">{a.thumbnailPath?<img src={'dream-media://'+a.id+'/thumbnail'} alt=""/>:a.kind==='audio'?<Music2 size={28}/>:<Film size={28}/>}<span>{Math.round(a.durationSec)}s</span>{p.selected.includes(a.id)&&<i><Check size={14}/></i>}</div><strong>{a.filename}</strong></button>
   <div className="asset-status">{a.missing?'Original source missing':a.playback?.ready||a.status==='ready'?'Ready to play':a.status==='failed'?'Playback preparation failed':'Preparing playback…'}</div>
   {a.hasAudio&&<SpeechStatus assetId={a.id} project={p.project} command={p.command}/>}
   {a.status==='failed'&&<button className="text-button" onClick={()=>p.command({type:'retry',assetId:a.id,step:'analysis'})}>Retry preparation</button>}
   {a.missing&&<button className="text-button" onClick={async()=>{const paths=await window.dream.pickMedia();if(paths[0])await p.command({type:'relink',assetId:a.id,path:paths[0]});}}>Relink source</button>}
  </article>)}</div>
  {!p.project.footage.assets.length&&<div className="drawer-empty"><Upload size={25}/><p>Add videos, images, or audio.</p><small>Imports are copied into this project.</small></div>}
 </div>;
}


function SpeechStatus({assetId,project,command}:{assetId:string;project:ProjectState;command:CommandFn}){
 const job=project.jobs.find(j=>j.assetId===assetId&&j.step==='transcription');if(!job)return null;
 if(job.status==='complete')return <div className="asset-status">Speech ready</div>;
 if(job.status==='running'||job.status==='queued')return <div className="asset-status">Transcribing speech{job.percent?` · ${Math.round(job.percent)}%`: '…'}</div>;
 return <div className="asset-status asset-scan-error"><details><summary>Speech {job.status==='interrupted'?'paused':'unavailable'}</summary><p>{job.error}</p></details><button className="text-button" onClick={()=>command({type:'retry',assetId,step:'transcription'})}>Retry speech</button></div>;
}
