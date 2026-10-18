import React,{useEffect,useState} from 'react';
import type {PublicActivity} from '@dream/contracts';
import {Eye,Code2,Sparkles,Search} from 'lucide-react';
import {editingActivity} from '../../editing-language';
import {GumboMark} from '../home/HomeScreen';

/** What Gumbo is doing, shown over the preview while it works, so every kind of work is visible and not only changes
 * landing on the timeline (the cursor shows those):
 * - checking footage: the clips it is looking at as a filmstrip, with a scan line sweeping across;
 * - writing the edit's code: a code window, its lines appearing as they stream in;
 * - searching for material: the query, with results arriving;
 * - thinking: Gumbo's mark with an orbit and what it is thinking about.
 * It sits over the preview's own frame and follows it as the editor is resized. */
export type Work='footage'|'code'|'search'|'thinking';
const FOOTAGE=new Set(['view_media','read_transcript','look','watch','listen','frames','grab_frames','inspect_media','contact_sheet']);
const CODE=new Set(['write_file','edit_file','read_file','run_command','bundle_scene','list_files','propose_file_changes']);
const SEARCH=new Set(['search','find_media','search_media','media_search']);
export function workOf(step:PublicActivity|undefined):Work{
 if(!step)return 'thinking';
 if(step.kind==='reasoning')return 'thinking';
 if(step.media?.length||step.tool&&FOOTAGE.has(step.tool))return 'footage';
 if(step.tool&&SEARCH.has(step.tool))return 'search';
 if(step.kind==='terminal'||step.tool&&CODE.has(step.tool))return 'code';
 return 'thinking';
}
const thumb=(id:string)=>`dream-media://${id}/thumbnail`;

export function AgentStage({step,root,label}:{step?:PublicActivity;root:React.RefObject<HTMLElement|null>;label:string}){
 const [box,setBox]=useState<{left:number;top:number;width:number;height:number}|null>(null),work=workOf(step);
 // The preview's frame, relative to the editor, measured now and whenever the editor changes size.
 useEffect(()=>{
  const measure=()=>{const r=root.current,v=r?.querySelector('.preview-viewport');if(!r||!v){setBox(null);return;}const a=r.getBoundingClientRect(),b=v.getBoundingClientRect();setBox({left:b.left-a.left,top:b.top-a.top,width:b.width,height:b.height});};
  measure();const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);return()=>observer.disconnect();
 },[root]);
 if(!box)return null;
 const text=step?editingActivity(step):label,lines=(step?.detail??'').split('\n').filter(l=>l.trim()).slice(-9);
 return <div className={'agent-stage '+work} style={{left:box.left,top:box.top,width:box.width,height:box.height}} aria-live="polite">
  <div className="agent-stage-card">
   {work==='footage'&&<>
    <div className="stage-strip">{(step?.media?.length?step.media.slice(0,5):[undefined,undefined,undefined]).map((m,i)=><div key={m?.id??i} className="stage-frame">{m&&<img src={thumb(m.id)} alt="" onError={e=>{e.currentTarget.style.visibility='hidden';}}/>}</div>)}<i className="stage-scan"/></div>
    <p><Eye size={14}/>{text}{step?.media?.[0]&&<small>{step.media[0].name}</small>}</p>
   </>}
   {work==='code'&&<>
    <div className="stage-code"><header><span/><span/><span/><b>{step?.files?.[0]?.path?.split(/[\\/]/).pop()??'edit.tsx'}</b></header>
     <pre>{lines.length?lines.map((l,i)=><code key={i} style={{animationDelay:`${i*60}ms`}}>{l.slice(0,90)}</code>):[78,54,66,40,72,58].map((w,i)=><code key={i} className="ghost" style={{width:`${w}%`,animationDelay:`${i*180}ms`}}/>)}<i className="stage-caret"/></pre></div>
    <p><Code2 size={14}/>{text}</p>
   </>}
   {work==='search'&&<>
    <div className="stage-search"><div className="stage-query"><Search size={15}/><span>{(step?.detail??text).split('\n')[0].slice(0,70)}</span></div><div className="stage-results">{[0,1,2,3].map(i=><i key={i} style={{animationDelay:`${i*220}ms`}}/>)}</div></div>
    <p><Search size={14}/>{text}</p>
   </>}
   {work==='thinking'&&<>
    <div className="stage-think"><div className="stage-orbit"><i/><i/><i/></div><GumboMark/></div>
    <p><Sparkles size={14}/>{step?.kind==='reasoning'&&step.text?step.text.split('\n')[0].slice(0,120):text}</p>
   </>}
  </div>
 </div>;
}
