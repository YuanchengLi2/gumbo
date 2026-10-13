import React,{useEffect,useState} from 'react';
import {Plus,Minus,PenLine,ChevronRight,Undo2,Check} from 'lucide-react';
import type {TimelineChange} from '@dream/timeline';
import {useEditorActions} from '../workspace/editor-actions';

/** What a request changed, as Codex and Claude Code show a diff: one card listing each change. Opening a row shows its
 * details and lights it up on the timeline with the playhead on it (without selecting it, so it does not go into the chat); Undo reverts that
 * change alone as a new undoable step. */
const clock=(sec?:number)=>sec===undefined?'':`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
const icons={added:Plus,removed:Minus,changed:PenLine};
const LIMIT=6;

export function ChangeCards({turnId,refresh,fallback}:{turnId:string;refresh:string;fallback:React.ReactNode}){
 const [changes,setChanges]=useState<TimelineChange[]|null>(null),[open,setOpen]=useState<string|null>(null),[undone,setUndone]=useState<Set<string>>(new Set()),[all,setAll]=useState(false),[error,setError]=useState('');
 const actions=useEditorActions();
 useEffect(()=>{let current=true;void window.dream.command({type:'turn_changes',turnId}).then((r:any)=>{if(current)setChanges(Array.isArray(r?.changes)?r.changes:[]);}).catch(()=>{if(current)setChanges([]);});return()=>{current=false;};},[turnId,refresh]);
 if(changes===null)return null;if(!changes.length)return <>{fallback}</>;
 const shown=all?changes:changes.slice(0,LIMIT),added=changes.filter(c=>c.kind==='added').length,removed=changes.filter(c=>c.kind==='removed').length,edited=changes.length-added-removed;
 const choose=(c:TimelineChange)=>{const next=open===c.key?null:c.key;setOpen(next);setError('');if(next)actions?.focus(c.kind==='removed'?undefined:c.id,c.start);};
 const undo=async(c:TimelineChange)=>{if(!actions||!c.restore?.length)return;setError('');const ok=await actions.apply(c.restore,'Undo: '+c.title);if(ok)setUndone(new Set([...undone,c.key]));else setError('That change could not be undone; the timeline has changed since.');};
 return <section className="change-card" aria-label="Changes">
  <header><strong>{changes.length} {changes.length===1?'change':'changes'}</strong><span>{[added&&`+${added}`,edited&&`~${edited}`,removed&&`−${removed}`].filter(Boolean).join('  ')}</span></header>
  <ol>{shown.map(c=>{const Icon=icons[c.kind],expanded=open===c.key,isUndone=undone.has(c.key);return <li key={c.key} className={`change-row ${c.kind}${expanded?' open':''}${isUndone?' undone':''}`}>
   <div className="change-line">
    <button type="button" className="change-main" aria-expanded={expanded} onClick={()=>choose(c)}><span className="change-icon"><Icon size={12}/></span><span className="change-title">{c.title}</span>{c.start!==undefined&&<small>{clock(c.start)}{c.end!==undefined&&c.end-c.start>=.5?`–${clock(c.end)}`:''}</small>}<ChevronRight size={13} className="change-chevron"/></button>
    {c.restore?.length?<button type="button" className="change-undo" disabled={isUndone||actions?.locked} title={isUndone?'Undone':'Undo this change'} aria-label={(isUndone?'Undone: ':'Undo ')+c.title} onClick={()=>void undo(c)}>{isUndone?<Check size={13}/>:<Undo2 size={13}/>}</button>:null}
   </div>
   {expanded&&<div className="change-details">{c.details.length?<ul>{c.details.map((d,n)=><li key={n}>{d}</li>)}</ul>:null}<p>{c.kind==='removed'?'No longer on the timeline. Undo puts it back.':'Shown on the timeline. Click it there to change it yourself.'}</p></div>}
  </li>;})}</ol>
  {changes.length>LIMIT&&<button type="button" className="change-more" onClick={()=>setAll(!all)}>{all?'Show fewer':`Show ${changes.length-LIMIT} more`}</button>}
  {error&&<p className="change-error" role="alert">{error}</p>}
 </section>;
}
