import React,{useEffect,useState} from 'react';
import {MEDIA} from '@dream/config';
import {Music2,AudioLines,ArrowUpRight,LoaderCircle,Square,Film} from 'lucide-react';
import type {ProjectState} from '@dream/project-db';
import type {LibraryRevision,VisualRevision,Command} from '@dream/contracts';

/** The library is for browsing and auditioning. Creative changes go through the shared chat engine. */
export function MusicLibrary({project,catalog,command,ask}:{project:ProjectState|null;catalog:{scores:any[];sfx:any[]};command:(c:Command)=>Promise<any>;ask:(text:string,assetId?:string)=>void}){
 const [saved,setSaved]=useState<any[]>([]),[visuals,setVisuals]=useState<any[]>([]),[selected,setSelected]=useState(''),[revision,setRevision]=useState<LibraryRevision|null>(null),[audioBefore,setAudioBefore]=useState<number|null>(null),[visualBefore,setVisualBefore]=useState<number|null>(null);
 useEffect(()=>{setRevision(null);if(selected)void window.dream.command<LibraryRevision>({type:'library_get',revisionId:selected}).then(setRevision);},[selected]);
 async function load(kind:'audio'|'visual',more=false){if(!project)return;const before=more?(kind==='audio'?audioBefore:visualBefore):null;const page=await window.dream.command<{items:any[];nextBefore:number|null}>({type:'library_page',kind,before:before??undefined,limit:20});if(kind==='audio'){setSaved(old=>more?[...old,...page.items]:page.items);setAudioBefore(page.nextBefore);}else{setVisuals(old=>more?[...old,...page.items]:page.items);setVisualBefore(page.nextBefore);}}
 const refresh=()=>{void load('audio');void load('visual');};
 useEffect(()=>{refresh();return window.dream.onEvent(event=>{if(event.type==='creation.completed')refresh();});},[project?.meta.id]);
 const jobs=project?.jobs.filter(j=>['creation','generation','score_binding'].includes(j.step)&&j.status!=='complete')??[];
 return <div className="catalog music-library">
  <p className="score-note">Describe what you want in chat. Gumbo creates, places and saves the result here. Browse saved work to reuse it or ask for a variation.</p>
  {jobs.map(job=><div className="generation-job" key={job.id}><span>{['running','queued'].includes(job.status)?<LoaderCircle size={14} className="spinning"/>:<AudioLines size={14}/>} {job.status.replaceAll('_',' ')} {job.status==='running'?`${Math.round(job.percent)}%`:''}</span>{job.error&&<small>{job.error}</small>}{['running','queued'].includes(job.status)?<button onClick={()=>command({type:'generation_cancel',requestId:job.assetId})}><Square size={12}/> Cancel</button>:['creation','generation'].includes(job.step)&&<button onClick={()=>command({type:'generation_resume',requestId:job.assetId})}>Resume</button>}</div>)}
  {!!visuals.length&&<><h4>Saved visuals <span>Original scenes and effects</span></h4><div className="catalog-list">{visuals.map(v=><button key={v.revisionId} onClick={()=>ask(`Reuse the saved visual “${v.title}” in this edit, adapting it to the current theme.`,v.assetId)}><Film size={16}/><span>{v.title}<small>{(v.durationInFrames/v.fps).toFixed(1)} seconds · saved scene</small></span><ArrowUpRight size={14}/></button>)}</div></>}
  {visualBefore&&<button className="text-button" onClick={()=>void load('visual',true)}>Load more visuals</button>}
  {audioBefore&&<button className="text-button" onClick={()=>void load('audio',true)}>Load more audio</button>}
  {!!saved.length&&<><h4>Your saved audio</h4><select aria-label="Saved media revision" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a score or sound</option>{saved.map(r=><option key={r.revisionId} value={r.revisionId}>{r.title}</option>)}</select></>}
  {revision&&<div className="score-editor"><h3>{revision.title}</h3><audio controls preload="metadata" src={`${MEDIA}${revision.assetId}/audio`}/><button className="button secondary compact" onClick={()=>ask(`Use the saved audio “${revision.title}” in this edit and fit it to the story.`,revision.assetId)}>Ask Gumbo to use this</button><button className="button secondary compact" onClick={()=>ask(`Create a variation of the saved audio “${revision.title}” that fits this edit.`,revision.assetId)}>Ask for a variation</button>
   {revision.document&&<details><summary>Listen to individual stems</summary>{revision.stemAssetIds.map(stem=><label className="score-stem" key={stem.assetId}><span>{revision.document!.tracks.find(t=>t.id===stem.trackId)?.name??'Instrument'}</span><audio controls preload="none" src={`${MEDIA}${stem.assetId}/audio`}/></label>)}</details>}
  </div>}
  <h4>Score inspiration <span>Starting points for Gumbo</span></h4><div className="catalog-list">{catalog.scores.map(p=><button key={p.id} disabled={!project} onClick={()=>ask(`Create music for this edit using “${p.name}” as a starting point. Adapt its ${p.mood} mood to the story and place it on the timeline.`)}><Music2 size={16}/><span>{p.name}<small>{p.mood} · {p.tempo} BPM</small></span><ArrowUpRight size={14}/></button>)}</div>
  <h4>Sound inspiration</h4><div className="catalog-list">{catalog.sfx.map(p=><button key={p.id} disabled={!project} onClick={()=>ask(`Create a sound effect inspired by “${p.name}” and place it where it best fits this edit.`)}><AudioLines size={16}/><span>{p.name}</span><ArrowUpRight size={14}/></button>)}</div>
 </div>;
}
