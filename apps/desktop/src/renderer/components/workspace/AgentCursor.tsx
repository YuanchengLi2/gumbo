import React,{useEffect,useRef,useState} from 'react';
import {Square} from 'lucide-react';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {manualItems} from '../../manual/model';
import type {PublicActivity} from '@dream/contracts';

/** While Gumbo edits, the editor shows it the way Codex or Antigravity show an agent using your computer: a glow around the
 * editor, a bar saying so with Stop, and Gumbo's cursor flying around the timeline doing things. Each block the edit adds,
 * moves or trims is visited first, in timeline order, and lights up as it lands; between changes the cursor keeps working
 * over the blocks that fit what Gumbo is doing (the clips while it checks footage, titles and overlays while it writes
 * the edit), clicking each with a word on the action, so the editor never sits still while Gumbo thinks or codes. */
/** What Gumbo is doing right now, from its running step, for where the cursor works and what it says. */
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
const HOP_MS=420,WANDER_MS=1300,MAX_HOPS=6;
type Spot={x:number;y:number;id?:string;action:string;click:number};
type Item={id:string;start:number;end:number;track:string;label:string};
const signature=(i:Item)=>`${i.track}|${i.start.toFixed(3)}|${i.end.toFixed(3)}|${i.label}`;
const pick=<T,>(list:T[])=>list[Math.floor(Math.random()*list.length)];
// What the cursor says it's doing on a block, by the block's kind and what Gumbo is doing.
const verbs=(track:string,work:Work,changed:boolean)=>{
 const kind=/music|audio|sound|voice/i.test(track)?'audio':/video|main|spine|clip/i.test(track)?'video':'graphic';
 if(changed)return kind==='audio'?['Setting the level','Placing the sound']:kind==='video'?['Placing the cut','Trimming']:['Placing the title','Setting it in'];
 if(work==='footage')return kind==='video'?['Checking the clip','Watching this shot','Finding the moment']:['Checking the timing','Lining it up'];
 if(work==='code')return kind==='graphic'?['Editing properties','Adjusting the style','Tweaking the motion']:['Adjusting timing','Editing properties'];
 if(work==='search')return ['Looking for a fit','Comparing options'];
 return kind==='audio'?['Listening','Checking the mix']:kind==='video'?['Reviewing the cut','Checking the pacing']:['Reviewing the title','Checking the layout'];
};

export function AgentCursor({active,label,steps=[],stage,timeline,footage,onStop}:{active:boolean;label:string;steps?:PublicActivity[];stage:React.RefObject<HTMLElement|null>;timeline:TimelineDocument;footage:FootageIndex;onStop:()=>void}){
 const [spot,setSpot]=useState<Spot|null>(null),seen=useRef<Map<string,string>|null>(null),items=useRef<Map<string,Item>>(new Map()),queue=useRef<string[]>([]),timer=useRef<number|undefined>(undefined),last=useRef<string|undefined>(undefined);
 const work=workOf([...steps].reverse().find(e=>['running','drafting'].includes(e.status))),workRef=useRef(work);workRef.current=work;
 const at=(block:HTMLElement,id:string,action:string)=>{
  const root=stage.current!;block.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
  const r=root.getBoundingClientRect(),b=block.getBoundingClientRect();
  setSpot({x:Math.min(b.right-6,b.left+Math.max(14,b.width*(.25+Math.random()*.5)))-r.left,y:b.top-r.top+b.height*.6,id,action,click:Date.now()});
  block.dataset.aiTouched='true';window.setTimeout(()=>{delete block.dataset.aiTouched;},900);last.current=id;
 };
 const step=()=>{
  timer.current=undefined;const root=stage.current;if(!root)return;
  const id=queue.current.shift();
  if(id!==undefined){const block=root.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`),item=items.current.get(id);if(block)at(block,id,pick(verbs(item?.track??'',workRef.current,true)));timer.current=window.setTimeout(step,queue.current.length?HOP_MS:WANDER_MS);return;}
  // Nothing new landed: keep working over the blocks that fit what Gumbo is doing, never the same one twice running.
  const blocks=[...root.querySelectorAll<HTMLElement>('[data-item-id]')].filter(b=>b.offsetParent&&b.dataset.itemId!==last.current);
  const fits=blocks.filter(b=>{const t=items.current.get(b.dataset.itemId!)?.track??'';return workRef.current==='footage'?/video|main|spine|clip/i.test(t):workRef.current==='code'?!/video|main|spine|clip|music|audio/i.test(t):true;});
  const block=pick(fits.length?fits:blocks);
  if(block){const item=items.current.get(block.dataset.itemId!);at(block,block.dataset.itemId!,pick(verbs(item?.track??'',workRef.current,false)));}
  else{const preview=root.querySelector('.preview-viewport');if(preview){const r=root.getBoundingClientRect(),b=preview.getBoundingClientRect();setSpot({x:b.left-r.left+b.width*(.3+Math.random()*.4),y:b.top-r.top+b.height*(.3+Math.random()*.4),action:'Watching the preview',click:Date.now()});}}
  timer.current=window.setTimeout(step,WANDER_MS+Math.random()*700);
 };
 // Each new draft is compared with the last one; what changed is visited first, in timeline order.
 useEffect(()=>{
  let list:Item[];try{list=manualItems(timeline,footage) as Item[];}catch{return;}
  items.current=new Map(list.map(i=>[i.id,i]));
  const now=new Map(list.map(i=>[i.id,signature(i)]));
  if(!active){seen.current=now;return;}
  const before=seen.current;seen.current=now;if(!before)return;
  const changed=list.filter(i=>before.get(i.id)!==now.get(i.id)).sort((a,b)=>a.start-b.start).map(i=>i.id);
  if(!changed.length)return;queue.current=[...queue.current,...changed].slice(-MAX_HOPS);
  if(timer.current!==undefined){clearTimeout(timer.current);timer.current=undefined;}step();
 },[timeline,footage,active]);
 useEffect(()=>{if(active){if(timer.current===undefined)step();}else{queue.current=[];if(timer.current!==undefined){clearTimeout(timer.current);timer.current=undefined;}setSpot(null);}},[active]);
 useEffect(()=>()=>{if(timer.current!==undefined)clearTimeout(timer.current);},[]);
 if(!active)return null;
 return <>
  <div className="agent-glow" aria-hidden="true"/>
  {/* The editor is locked while Gumbo edits: clicks and drags land on this shield, not the player or timeline. */}
  <div className="agent-lock" aria-hidden="true" onPointerDown={e=>e.preventDefault()}/>
  <div className="agent-bar" role="status"><span className="agent-bar-dot"/><span>{label}</span><button type="button" onClick={onStop}><Square size={9} fill="currentColor"/>Stop</button></div>
  {spot&&<div className="agent-cursor" aria-hidden="true" style={{transform:`translate(${spot.x}px,${spot.y}px)`}}>
   <i key={spot.click} className="agent-click"/>
   <svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 1.5 L2 18 L6.6 13.8 L9.6 20.5 L12.6 19.2 L9.7 12.6 L16 12.6 Z" fill="#2f6bff" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/></svg>
   <span key={spot.action+spot.click}>{spot.action}</span>
  </div>}
 </>;
}
