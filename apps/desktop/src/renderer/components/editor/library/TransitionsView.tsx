import React,{useMemo} from 'react';
import {TRANSITIONS} from '@dream/timeline';
import {EngineTile,transitionEdit} from './LibraryViews';

/** The transitions library: each tile is the engine drawing its transition between two shots (the middle of it at rest,
 * played on hover), so it looks exactly as it will on the cut. Drag one onto a cut on the timeline, or click it to put it
 * on the cut into the selected clip (or the cut nearest the playhead). */
export function TransitionsView(p:{disabled:boolean;onApply:(type:string)=>void}){
 const edits=useMemo(()=>new Map(TRANSITIONS.map(t=>[t.id,transitionEdit({type:t.id,durationSec:Math.min(1.2,Math.max(.6,t.durationSec*1.5))})])),[]);
 return <div className="library">
  <p className="library-hint">Drag onto a cut, or click to add it to the selected clip’s cut.</p>
  <div className="library-grid">{TRANSITIONS.map(t=><button key={t.id} type="button" className="library-tile" title={t.about} disabled={p.disabled} draggable={!p.disabled}
   onDragStart={e=>{e.dataTransfer.setData('application/x-dream-transition',t.id);e.dataTransfer.effectAllowed='copy';}} onClick={()=>p.onApply(t.id)}>
   <EngineTile edit={edits.get(t.id)!} rest={1.2}/>
   <span className="library-name">{t.name}</span></button>)}</div>
 </div>;
}
