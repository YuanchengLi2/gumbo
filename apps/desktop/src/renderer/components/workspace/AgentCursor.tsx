import React,{useEffect,useRef,useState} from 'react';
import {Square} from 'lucide-react';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {manualItems} from '../../manual/model';

/** While Figjam edits, the editor shows it the way Codex or Antigravity show an agent using your computer: a blue glow
 * around the editor, a bar saying so with Stop, and Figjam's cursor gliding to each block the edit adds, moves or trims as
 * the draft streams in, which lights up as it lands. Between changes the cursor rests over the preview. */
const HOP_MS=420,MAX_HOPS=6;
type Spot={x:number;y:number;id?:string};
const signature=(i:{start:number;end:number;track:string;label:string})=>`${i.track}|${i.start.toFixed(3)}|${i.end.toFixed(3)}|${i.label}`;

export function AgentCursor({active,label,stage,timeline,footage,onStop}:{active:boolean;label:string;stage:React.RefObject<HTMLElement|null>;timeline:TimelineDocument;footage:FootageIndex;onStop:()=>void}){
 const [spot,setSpot]=useState<Spot|null>(null),seen=useRef<Map<string,string>|null>(null),queue=useRef<string[]>([]),timer=useRef<number|undefined>(undefined);
 const rest=()=>{const root=stage.current,preview=root?.querySelector('.preview-viewport');if(!root||!preview)return;const r=root.getBoundingClientRect(),b=preview.getBoundingClientRect();setSpot({x:b.left-r.left+b.width*.62,y:b.top-r.top+b.height*.58});};
 const hop=()=>{
  const root=stage.current,id=queue.current.shift();timer.current=undefined;if(!root)return;
  if(id===undefined){rest();return;}
  const block=root.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
  if(block){block.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
   const r=root.getBoundingClientRect(),b=block.getBoundingClientRect();setSpot({x:Math.min(b.right,b.left+Math.max(14,b.width*.5))-r.left,y:b.top-r.top+b.height*.6,id});
   block.dataset.aiTouched='true';window.setTimeout(()=>{delete block.dataset.aiTouched;},1100);}
  timer.current=window.setTimeout(hop,queue.current.length?HOP_MS:2200);
 };
 // Each new draft is compared with the last one; what changed is visited in timeline order.
 useEffect(()=>{
  let items:ReturnType<typeof manualItems>;try{items=manualItems(timeline,footage);}catch{return;}
  const now=new Map(items.map(i=>[i.id,signature(i)]));
  if(!active){seen.current=now;return;}
  const before=seen.current;seen.current=now;if(!before)return;
  const changed=items.filter(i=>before.get(i.id)!==now.get(i.id)).sort((a,b)=>a.start-b.start).map(i=>i.id);
  if(!changed.length)return;queue.current=[...queue.current,...changed].slice(-MAX_HOPS);if(timer.current===undefined)hop();
 },[timeline,footage,active]);
 useEffect(()=>{if(active){rest();}else{queue.current=[];if(timer.current!==undefined){clearTimeout(timer.current);timer.current=undefined;}setSpot(null);}},[active]);
 useEffect(()=>()=>{if(timer.current!==undefined)clearTimeout(timer.current);},[]);
 if(!active)return null;
 return <>
  <div className="agent-glow" aria-hidden="true"/>
  {/* The editor is locked while Figjam edits: clicks and drags land on this shield, not the player or timeline. */}
  <div className="agent-lock" aria-hidden="true" onPointerDown={e=>e.preventDefault()}/>
  <div className="agent-bar" role="status"><span className="agent-bar-dot"/><span>{label}</span><button type="button" onClick={onStop}><Square size={9} fill="currentColor"/>Stop</button></div>
  {spot&&<div className="agent-cursor" aria-hidden="true" style={{transform:`translate(${spot.x}px,${spot.y}px)`}}>
   <svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 1.5 L2 18 L6.6 13.8 L9.6 20.5 L12.6 19.2 L9.7 12.6 L16 12.6 Z" fill="#2f6bff" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/></svg>
   <span>Figjam</span>
  </div>}
 </>;
}
