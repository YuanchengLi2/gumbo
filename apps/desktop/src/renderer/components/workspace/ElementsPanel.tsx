import React,{useMemo,useState} from 'react';
import {Film,Type,Sparkles,Layers,Wand2,SlidersHorizontal,AudioLines,Music2,Captions,ArrowRightLeft,X} from 'lucide-react';
import type {ProjectState} from '@dream/project-db';
import type {Op} from '@dream/timeline';
import {manualItems,removeItems,reason as manualReason,type Item,type Look} from '../../manual/model';
import {useEditorActions} from './editor-actions';

/** Everything on the timeline in one list, grouped as an editor thinks of it: clips, transitions, text, motion graphics,
 * overlays, effects, filters, sound effects, music and captions. Each says whether Gumbo or you added it; clicking one
 * selects it on the timeline with the playhead on it, and the X removes it. */
type Row={id:string;focus?:string;label:string;start:number;end:number;by:'gumbo'|'you';remove:Op[]};
const groups:[string,typeof Film,(i:Item)=>boolean][]=[
 ['Clips',Film,i=>i.kind==='clip'],['Text and titles',Type,i=>i.look==='text'],['Motion graphics',Sparkles,i=>i.look==='graphic'&&i.kind!=='clip'],
 ['Overlays and B-roll',Layers,i=>i.look==='overlay'],['Effects',Wand2,i=>i.look==='effect'],['Filters',SlidersHorizontal,i=>i.look==='filter'],
 ['Sound effects',AudioLines,i=>i.look==='sfx'],['Music and voice',Music2,i=>i.kind==='music']];
const clock=(sec:number)=>`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
const transitionNames:Record<string,string>={crossfade:'Cross dissolve',dip_to_black:'Dip to black',whip:'Whip',zoom_through:'Zoom through',slide:'Slide'};

export function ElementsPanel({project,selected}:{project:ProjectState;selected:string[]}){
 const actions=useEditorActions(),[mine,setMine]=useState(false),t=project.timeline,f=project.footage;
 const sections=useMemo(()=>{
  let items:Item[]=[];try{items=manualItems(t,f);}catch{}
  const reasons=new Map<string,string>([...t.spine,...t.attached,...t.music].map(e=>[e.id,e.reason??'']));
  const by=(id:string):Row['by']=>reasons.get(id)===manualReason?'you':'gumbo';
  const out:{title:string;Icon:typeof Film;rows:Row[]}[]=groups.map(([title,Icon,match])=>({title,Icon,rows:items.filter(i=>i.kind!=='caption'&&match(i)).map(i=>({id:i.id,focus:i.id,label:i.label,start:i.start,end:i.end,by:by(i.id),remove:removeItems(t,f,[i.id])}))}));
  const clips=items.filter(i=>i.kind==='clip');
  out.splice(1,0,{title:'Transitions',Icon:ArrowRightLeft,rows:t.spine.flatMap(c=>{const tr=c.transitionIn;if(!tr||tr.type==='cut')return[];const at=clips.find(i=>i.id===c.id);return[{id:'transition:'+c.id,focus:c.id,label:`${transitionNames[tr.type]??tr.type} into ${at?.label??'clip'}`,start:at?.start??0,end:(at?.start??0)+tr.durationSec,by:by(c.id),remove:[{type:'set_transition',clipId:c.id,transition:null,reason:manualReason}]}];})});
  const words=items.filter(i=>i.kind==='caption');
  if(words.length)out.push({title:'Captions',Icon:Captions,rows:[{id:'captions',focus:words[0].id,label:`${words.length} words of captions`,start:words[0].start,end:words.at(-1)!.end,by:'gumbo',remove:[{type:'set_captions',captions:null,reason:manualReason}]}]});
  return out.map(s=>({...s,rows:mine?s.rows.filter(r=>r.by==='gumbo'):s.rows})).filter(s=>s.rows.length);
 },[t,f,mine]);
 const total=sections.reduce((n,s)=>n+s.rows.length,0);
 return <div className="elements-panel">
  <header><span>{total} {total===1?'element':'elements'}</span><label className="elements-filter"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/>Only what Gumbo added</label></header>
  {!total&&<p className="elements-empty">{mine?'Gumbo has not added anything yet.':'Nothing on the timeline yet.'}</p>}
  {sections.map(({title,Icon,rows})=><section key={title} aria-label={title}><h3><Icon size={13}/>{title}<small>{rows.length}</small></h3>
   <ul>{rows.map(r=><li key={r.id} className={selected.includes(r.focus??'')?'selected':''}>
    <button type="button" className="element-main" onClick={()=>actions?.focus(r.focus,r.start)}><span>{r.label}</span><small>{clock(r.start)}–{clock(r.end)}</small>{r.by==='gumbo'&&<em>Gumbo</em>}</button>
    <button type="button" className="element-remove" aria-label={'Remove '+r.label} disabled={actions?.locked} onClick={()=>void actions?.apply(r.remove,'Remove '+r.label)}><X size={12}/></button>
   </li>)}</ul></section>)}
 </div>;
}
