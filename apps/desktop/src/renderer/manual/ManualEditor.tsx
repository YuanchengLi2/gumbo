import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {TimelineComposition} from '@dream/composition';
import {resolve,type Op,type TimelineDocument} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import type {VisualRevision} from '@dream/contracts';
import {Play,Pause,SkipBack,SkipForward,Upload,Search,Plus,Layers,Type,Music2,Film} from 'lucide-react';
import {ManualTimeline} from './ManualTimeline';
import {addAsset,manualItems,removeItems,splitItems,duplicateItems,ensureDuration,newId,projectAnchor,reason,type Item} from './model';
import './manual.css';
import {ManualLibrary} from './ManualLibrary';
import {ManualInspector} from './ManualInspector';
import {ProjectPlayer} from '../components/player/ProjectPlayer';
import {useEditor} from '../store/editor';

type Props={project:ProjectState;player:React.RefObject<PlayerRef|null>;frame:number;playing:boolean;selected:string[];busy:boolean;shortcutsEnabled:boolean;onSeek:(frame:number)=>void;onSelect:(ids:string[])=>void;command:(c:any)=>Promise<any>;onImport:()=>void;onError:(text:string)=>void};
export function ManualEditor(p:Props){
 const [preview,setPreview]=useState<TimelineDocument|null>(null),[sizes,setSizes]=useState({left:30,right:25,timeline:35});const clipboard=useRef<{timeline:TimelineDocument;ids:string[]}|null>(null);
 const t=p.project.timeline,f=p.project.footage,display=preview??t,r=useMemo(()=>resolve(display,f),[display,f]),items=useMemo(()=>manualItems(t,f),[t,f]),selected=items.find(i=>i.id===p.selected[0]),disabled=p.busy||p.project.aiStatus==='running';
 const props=useMemo(()=>({timeline:display,footage:f,media:Object.fromEntries(f.assets.map(a=>[a.id,`dream-media://${a.id}/preview`]))}),[display,f]);
 const execute=async(ops:Op[],label:string,expected=p.project.versionId)=>{if(disabled||!ops.length)return;return p.command({type:'apply',ops,label,expectedVersionId:expected,requestId:crypto.randomUUID(),snapToSpeech:false});};
 const run=(action:()=>Op[],label:string)=>{try{void execute(action(),label);}catch(error){p.onError((error as Error).message);}};
 const remove=()=>run(()=>removeItems(t,f,p.selected),'Delete selection');
 const split=()=>run(()=>splitItems(t,f,p.selected.length?p.selected:items.filter(i=>!t.trackSettings?.[i.track]?.locked).map(i=>i.id),p.frame/t.settings.fps),'Split at playhead');
 const duplicate=()=>run(()=>duplicateItems(t,f,p.selected),'Duplicate selection');
 useEffect(()=>{const valid=new Set(items.map(i=>i.id));if(p.selected.some(id=>!valid.has(id)))p.onSelect(p.selected.filter(id=>valid.has(id)));},[p.project.versionId]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!p.shortcutsEnabled||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable],audio'))return;if((e.target as HTMLElement).closest('button,summary')&&(e.code==='Space'||e.key==='Enter'))return;const mod=e.ctrlKey||e.metaKey;
  if(e.code==='Space'){e.preventDefault();p.player.current?.toggle();return;}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();p.onSeek(p.frame+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?t.settings.fps:1));return;}
  if(mod&&e.key.toLowerCase()==='a'){e.preventDefault();p.onSelect(items.map(i=>i.id));return;}if(e.key==='Escape'){p.onSelect([]);return;}if(disabled)return;
  if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();void p.command({type:e.shiftKey?'redo':'undo'});}else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();void p.command({type:'redo'});}else if(mod&&e.key.toLowerCase()==='c'){e.preventDefault();clipboard.current={timeline:structuredClone(t),ids:[...p.selected]};}else if(mod&&e.key.toLowerCase()==='x'){e.preventDefault();clipboard.current={timeline:structuredClone(t),ids:[...p.selected]};remove();}else if(mod&&e.key.toLowerCase()==='v'){e.preventDefault();const copy=clipboard.current;if(copy)run(()=>duplicateItems(copy.timeline,f,copy.ids,p.frame/t.settings.fps,t),'Paste selection');}else if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}else if(mod&&e.key.toLowerCase()==='b'||e.key.toLowerCase()==='s'&&!mod){e.preventDefault();split();}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[t,f,p.selected,p.frame,disabled,p.shortcutsEnabled,items]);

 const layer=Math.max(-1,...t.attached.filter(i=>i.type!=='sfx').map(i=>i.layer))+1;
 const insert=(id:string,track:string)=>run(()=>addAsset(t,f,id,track.startsWith('visual:')?'visual:'+layer:track,p.frame/t.settings.fps),'Add media');
 const element=(component:string)=>{const start=p.frame/t.settings.fps;run(()=>[...ensureDuration(t,start+3),{type:'add_item',item:{id:newId(),type:['punch_zoom','slow_push','shake','grade'].includes(component)?'effect':'overlay',component,start:projectAnchor(start),durationSec:3,layer,params:{text:component==='lower_third'?'Your name':'Your title',fontSize:60,color:'#ffffff',x:.5,y:component==='lower_third'?.8:.5,amount:.1},reason},reason}],'Add '+component.replaceAll('_',' '));};
 const resize=(key:'left'|'right'|'timeline',e:React.PointerEvent)=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;setSizes(old=>({...old,[key]:key==='timeline'?Math.max(25,Math.min(55,(window.innerHeight-e.clientY)/window.innerHeight*100)):key==='left'?Math.max(22,Math.min(36,e.clientX/window.innerWidth*100)):Math.max(22,Math.min(32,(window.innerWidth-e.clientX)/window.innerWidth*100))}));};
 return <div className="manual-editor" aria-label="Manual editor" style={{'--bin-width':`${sizes.left}%`,'--inspector-width':`${sizes.right}%`,'--timeline-height':`${sizes.timeline}%`} as React.CSSProperties}><div className="manual-stage"><ManualLibrary project={p.project} disabled={disabled} selected={selected} onImport={p.onImport} onInsert={insert} onElement={element} command={p.command} execute={execute}/><div className="manual-resizer vertical" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>resize('left',e)}/><section className="manual-viewer"><div className="manual-panel-heading"><strong>Player</strong></div><ProjectPlayer project={p.project} timeline={display} player={p.player} frame={p.frame} playing={p.playing} onFrame={useEditor.getState().setFrame} onPlaying={useEditor.getState().setPlaying} command={p.command} working={p.project.aiStatus==='running'} manual onImport={p.onImport}/>{p.project.aiStatus==='running'&&<div className="manual-ai-notice">Dream is editing. <button onClick={()=>void p.command({type:'cancel'})}>Pause AI to edit manually</button></div>}</section><div className="manual-resizer vertical" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>resize('right',e)}/><ManualInspector project={p.project} item={selected} selectedCount={p.selected.length} disabled={disabled} execute={execute} command={p.command} onError={p.onError}/></div><div className="manual-resizer horizontal" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>resize('timeline',e)}/><ManualTimeline project={p.project} frame={p.frame} selected={p.selected} disabled={disabled} onSelect={p.onSelect} onSeek={p.onSeek} onApply={execute} onPreview={setPreview} onSplit={split} onDuplicate={duplicate} onDelete={remove} onError={p.onError}/></div>;
}
