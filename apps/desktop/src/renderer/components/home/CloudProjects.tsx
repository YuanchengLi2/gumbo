import React,{useEffect,useState} from 'react';
import {X,Cloud,Trash2,Download} from 'lucide-react';

/** Gumbo's cloud in the window (the main app's cloud.ts does the transfers): Open from cloud lists the projects saved
 * from any computer, with the plan's space used, and brings one here; CloudStatus shows a save or download as it runs. */
type CloudProject={id:string;name:string;sizeBytes:number;files:number;updatedAt:string;device?:string|null};
type Progress={projectId:string;name:string;direction:'save'|'open';phase:'preparing'|'uploading'|'downloading'|'done';doneBytes:number;totalBytes:number};
export const size=(bytes:number)=>bytes>=1e9?`${(bytes/1e9).toFixed(bytes>=1e10?0:1)} GB`:bytes>=1e6?`${Math.round(bytes/1e6)} MB`:`${Math.max(1,Math.round(bytes/1e3))} KB`;
const message=(error:unknown)=>String((error as Error)?.message??error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');

export function CloudProjects(p:{onClose:()=>void;onOpen:(folder:string)=>void}){
 const [list,setList]=useState<{projects:CloudProject[];usedBytes:number;limitBytes:number}|null>(null),[error,setError]=useState<string>(),[busy,setBusy]=useState<string>(),[replace,setReplace]=useState<CloudProject|null>(null),[remove,setRemove]=useState<CloudProject|null>(null);
 const load=()=>window.dream.cloud({action:'list'}).then(setList,e=>setError(message(e)));
 useEffect(()=>{void load();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')p.onClose();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
 const open=async(project:CloudProject,overwrite=false)=>{setBusy(project.id);setError(undefined);
  try{const result=await window.dream.cloud({action:'open',projectId:project.id,overwrite});if(result?.exists){setReplace(project);return;}p.onOpen(result.folder);p.onClose();}
  catch(e){setError(message(e));}finally{setBusy(undefined);}};
 const drop=async(project:CloudProject)=>{setRemove(null);setBusy(project.id);try{await window.dream.cloud({action:'remove',projectId:project.id});await load();}catch(e){setError(message(e));}finally{setBusy(undefined);}};
 return <div className="project-confirm-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)p.onClose();}}>
  <section className="project-confirm cloud-projects" role="dialog" aria-modal="true" aria-label="Open from cloud">
   <button type="button" className="upgrade-close" aria-label="Close" onClick={p.onClose}><X size={16}/></button>
   <h3>Open from cloud</h3>
   <p>Projects saved to your cloud from any computer. Save one from its menu on the home screen.</p>
   {list&&list.limitBytes>0&&<div className="cloud-space" aria-label="Cloud space"><i style={{width:`${Math.min(100,list.usedBytes/list.limitBytes*100)}%`}}/><span>{size(list.usedBytes)} of {size(list.limitBytes)} used</span></div>}
   {error&&<p className="cloud-error" role="alert">{error}</p>}
   {!list&&!error&&<p className="cloud-empty">Loading…</p>}
   {list&&!list.projects.length&&<p className="cloud-empty">{list.limitBytes?'Nothing saved yet.':'Cloud storage comes with the Pro plan and above.'}</p>}
   {list&&list.projects.length>0&&<ul className="cloud-list">{list.projects.map(project=><li key={project.id}>
    <Cloud size={16}/>
    <span><b>{project.name}</b><small>{size(project.sizeBytes)} · saved {new Date(project.updatedAt).toLocaleString()}{project.device?` from ${project.device}`:''}</small></span>
    <button type="button" className="settings-button-secondary" disabled={!!busy} onClick={()=>void open(project)}><Download size={14}/>{busy===project.id?'Opening…':'Open'}</button>
    <button type="button" className="cloud-remove" aria-label={`Remove ${project.name} from the cloud`} title="Remove from the cloud" disabled={!!busy} onClick={()=>setRemove(project)}><Trash2 size={14}/></button>
   </li>)}</ul>}
   {replace&&<div className="cloud-ask" role="alertdialog" aria-label="Replace the copy on this computer"><p>“{replace.name}” is already on this computer. Replace it with the copy from the cloud? Changes made here since that save are lost.</p>
    <footer><button type="button" className="settings-button-secondary" onClick={()=>setReplace(null)}>Keep this one</button><button type="button" className="project-delete" onClick={()=>{const project=replace;setReplace(null);void open(project,true);}}>Replace</button></footer></div>}
   {remove&&<div className="cloud-ask" role="alertdialog" aria-label="Remove from the cloud"><p>Remove “{remove.name}” from the cloud? Copies on your computers stay.</p>
    <footer><button type="button" className="settings-button-secondary" onClick={()=>setRemove(null)}>Cancel</button><button type="button" className="project-delete" onClick={()=>void drop(remove)}>Remove</button></footer></div>}
  </section>
 </div>;
}

/** One line at the bottom of the window while a project is saved to or opened from the cloud. */
export function CloudStatus(){
 const [progress,setProgress]=useState<Progress|null>(null);
 useEffect(()=>{let clear:ReturnType<typeof setTimeout>|undefined;
  const off=window.dream.onEvent(raw=>{if(raw.type!=='cloud.progress')return;const next=raw.payload as Progress;setProgress(next);clearTimeout(clear);if(next.phase==='done')clear=setTimeout(()=>setProgress(null),4000);});
  return()=>{off();clearTimeout(clear);};},[]);
 if(!progress)return null;
 const share=progress.totalBytes?Math.round(progress.doneBytes/progress.totalBytes*100):100;
 const of=`${size(progress.doneBytes)} of ${size(progress.totalBytes)}`;
 const text=progress.phase==='preparing'?`Getting “${progress.name}” ready for the cloud… ${share}%`:progress.phase==='uploading'?`Saving “${progress.name}” to the cloud… ${of}`:progress.phase==='downloading'?`Opening “${progress.name}” from the cloud… ${of}`:progress.direction==='save'?`“${progress.name}” is saved in your cloud`:`“${progress.name}” is on this computer`;
 return <div className="cloud-status" role="status"><Cloud size={14}/><span>{text}</span>{progress.phase!=='done'&&<i style={{width:`${share}%`}}/>}</div>;
}
