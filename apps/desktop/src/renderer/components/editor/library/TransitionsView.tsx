import React from 'react';
import {TRANSITIONS} from '@dream/timeline';

/** The transitions library: each tile plays its transition between two shots. Drag one onto a cut on the timeline, or click
 * it to put it on the cut into the selected clip (or the cut nearest the playhead). */
export function TransitionsView(p:{disabled:boolean;onApply:(type:string)=>void}){
 return <div className="library">
  <p className="library-hint">Drag onto a cut, or click to add it to the selected clip’s cut.</p>
  <div className="library-grid">{TRANSITIONS.map(t=><button key={t.id} type="button" className="library-tile" title={t.about} disabled={p.disabled} draggable={!p.disabled}
   onDragStart={e=>{e.dataTransfer.setData('application/x-dream-transition',t.id);e.dataTransfer.effectAllowed='copy';}} onClick={()=>p.onApply(t.id)}>
   <span className={'transition-demo demo-'+t.id} aria-hidden="true"><i className="shot-a">A</i><i className="shot-b">B</i></span>
   <span className="library-name">{t.name}</span></button>)}</div>
 </div>;
}
