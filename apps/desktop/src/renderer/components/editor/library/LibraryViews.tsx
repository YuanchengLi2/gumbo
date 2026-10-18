import React,{useEffect,useMemo,useRef,useState} from 'react';
import {prepare,frameAt,Compositor,paintText,type TextLayer} from '@dream/compositor';
import {emptyTimeline,TimelineSchema,EFFECTS,FILTERS,TEXT_STYLES,STICKERS,STICKER_GROUPS,type TimelineDocument} from '@dream/timeline';
import {AssetSchema,emptyFootage,type FootageIndex} from '@dream/footage';
import type {LibraryDrop} from '../../../manual/model';

/** The editor's libraries, after OpenCut's asset views: effects, filters, text styles, stickers and caption styles. Every
 * tile is drawn by the engine itself (the frame description, the compositor and the text painter) from a small edit
 * holding that piece, so a tile looks exactly like what the piece does on the timeline; hovering one plays it. Drag a tile
 * onto the timeline, or click it to add it at the playhead (an effect or filter goes on the selected clip). */
const W=640,H=360;
let sample:OffscreenCanvas|undefined;
/** A small landscape drawn for the effect and filter tiles: sky, sun, hills, water and a figure. */
function samplePicture(){
 if(sample)return sample;sample=new OffscreenCanvas(W,H);const c=sample.getContext('2d')!;
 const sky=c.createLinearGradient(0,0,0,H*.62);sky.addColorStop(0,'#3d6fd8');sky.addColorStop(1,'#f3b98a');c.fillStyle=sky;c.fillRect(0,0,W,H);
 c.fillStyle='#ffe08a';c.beginPath();c.arc(W*.68,H*.42,34,0,Math.PI*2);c.fill();
 c.fillStyle='#4a5d8f';c.beginPath();c.moveTo(0,H*.62);c.lineTo(W*.2,H*.36);c.lineTo(W*.42,H*.6);c.lineTo(W*.62,H*.4);c.lineTo(W,H*.62);c.closePath();c.fill();
 c.fillStyle='#2f7a4f';c.fillRect(0,H*.62,W,H*.14);const water=c.createLinearGradient(0,H*.76,0,H);water.addColorStop(0,'#2a5aa8');water.addColorStop(1,'#13284f');c.fillStyle=water;c.fillRect(0,H*.76,W,H*.24);
 c.fillStyle='#ffd27a88';c.fillRect(W*.62,H*.8,W*.12,4);c.fillRect(W*.6,H*.86,W*.16,3);
 c.fillStyle='#1b1b24';c.beginPath();c.arc(W*.3,H*.5,10,0,Math.PI*2);c.fill();c.fillRect(W*.3-7,H*.5+8,14,34);
 return sample;
}
const footage=():FootageIndex=>{const f=emptyFootage();f.assets=[AssetSchema.parse({id:'sample',filename:'sample',kind:'image',originalPath:'sample.png',durationSec:3,width:W,height:H,fps:30,hasAudio:false,fingerprint:'sample',status:'ready'})];return f;};
const FOOTAGE=footage();
/** A three-second edit of the sample with one piece on it. */
function sampleEdit(o:{attached?:object[];framing?:object;picture?:boolean}):TimelineDocument{const t=emptyTimeline('library');
 return TimelineSchema.parse({...t,settings:{...t.settings,width:W,height:H},spine:o.picture===false?[]:[{id:'clip',assetId:'sample',srcIn:0,srcOut:3,holdSec:3,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},...(o.framing?{framing:{mode:'fill',scale:1,x:.5,y:.5,...o.framing}}:{}),reason:''}],attached:o.attached??[]});}
const item=(component:string,type:string,params:Record<string,unknown>)=>({id:'piece',type,component,start:{kind:'project',at:'start',offsetSec:0},durationSec:3,layer:0,params,reason:''});

let shared:Compositor|undefined;
/** Draws a frame of an edit on a tile's canvas: the picture through the compositor, then text and stickers on top. */
function drawTile(canvas:HTMLCanvasElement,edit:TimelineDocument,time:number,background='#111'){
 const ctx=canvas.getContext('2d');if(!ctx)return;const frame=frameAt(prepare({timeline:edit,footage:FOOTAGE}),time),scale=canvas.width/W;
 ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);
 if(frame.layers.some(l=>l.kind!=='text')){try{shared??=new Compositor(new OffscreenCanvas(W,H));
  shared.draw({...frame,layers:frame.layers.filter(l=>l.kind!=='text')},()=>samplePicture());ctx.drawImage(shared.canvas as OffscreenCanvas,0,0,canvas.width,canvas.height);}catch{}}
 for(const layer of frame.layers)if(layer.kind==='text')paintText(ctx,layer as TextLayer,W,H,scale);
}
/** A tile's picture: drawn once at rest, and played on a loop while the pointer is over it. */
function EngineTile({edit,rest,loop=2.4,background}:{edit:TimelineDocument;rest:number;loop?:number;background?:string}){
 const ref=useRef<HTMLCanvasElement>(null),[hover,setHover]=useState(false);
 useEffect(()=>{const canvas=ref.current;if(!canvas)return;if(!hover){drawTile(canvas,edit,rest,background);return;}
  let raf=0;const began=performance.now(),step=()=>{drawTile(canvas,edit,((performance.now()-began)/1000)%loop,background);raf=requestAnimationFrame(step);};step();return()=>cancelAnimationFrame(raf);},[edit,hover,rest,loop,background]);
 return <canvas ref={ref} width={192} height={108} className="engine-tile" onPointerEnter={()=>setHover(true)} onPointerLeave={()=>setHover(false)}/>;
}
function Tile(p:{name:string;title?:string;drop:LibraryDrop;disabled:boolean;onAdd:(drop:LibraryDrop)=>void;children:React.ReactNode;pressed?:boolean}){
 return <button type="button" className="library-tile" title={p.title} aria-pressed={p.pressed} disabled={p.disabled} draggable={!p.disabled}
  onDragStart={e=>{e.dataTransfer.setData('application/x-dream-library',JSON.stringify(p.drop));e.dataTransfer.effectAllowed='copy';}} onClick={()=>p.onAdd(p.drop)}>{p.children}<span className="library-name">{p.name}</span></button>;
}
type ViewProps={disabled:boolean;onAdd:(drop:LibraryDrop)=>void};

export function EffectsView(p:ViewProps){
 // Tiles are a tenth of a 1080p frame's size, so a look shows at its strongest there to read at all; motion a little past its default.
 const edits=useMemo(()=>new Map(EFFECTS.map(e=>[e.id,sampleEdit({attached:[item(e.id,'effect',Object.fromEntries(e.params.map(x=>[x.key,x.key!=='amount'?x.default:e.group==='look'?x.max:x.default*1.6])))]})])),[]);
 return <div className="library"><p className="library-hint">Drag onto a clip, or click to add to the selected clip.</p>
  {(['motion','look'] as const).map(group=><React.Fragment key={group}><h4>{group==='motion'?'Motion':'Looks'}</h4><div className="library-grid">{EFFECTS.filter(e=>e.group===group).map(e=><Tile key={e.id} name={e.name} title={e.about} drop={{kind:'effect',id:e.id}} disabled={p.disabled} onAdd={p.onAdd}><EngineTile edit={edits.get(e.id)!} rest={1.2}/></Tile>)}</div></React.Fragment>)}</div>;
}

export function FiltersView(p:ViewProps&{current?:string}){
 const edits=useMemo(()=>new Map(FILTERS.map(f=>[f.id,sampleEdit({framing:{filter:f.id,filterIntensity:1}})])),[]);
 return <div className="library"><p className="library-hint">Drag onto a clip, or click to grade the selected clip.</p>
  <div className="library-grid">{FILTERS.map(f=><Tile key={f.id} name={f.name} drop={{kind:'filter',id:f.id}} disabled={p.disabled} onAdd={p.onAdd} pressed={p.current===f.id}><EngineTile edit={edits.get(f.id)!} rest={1}/></Tile>)}</div></div>;
}

export function TextView(p:ViewProps){
 const edits=useMemo(()=>new Map(TEXT_STYLES.map(s=>[s.id,sampleEdit({picture:false,attached:[item('text','overlay',{text:s.sample,style:s.id,y:.5})]})])),[]);
 return <div className="library"><p className="library-hint">Click to add at the playhead, or drag onto the timeline.</p>
  <div className="library-grid text-grid">{TEXT_STYLES.map(s=><Tile key={s.id} name={s.name} drop={{kind:'text',id:s.id}} disabled={p.disabled} onAdd={p.onAdd}><EngineTile edit={edits.get(s.id)!} rest={1.5} loop={3} background="#2b2b2e"/></Tile>)}</div></div>;
}

export function StickersView(p:ViewProps){
 const edits=useMemo(()=>new Map(STICKERS.map(s=>[s.id,sampleEdit({picture:false,attached:[item('sticker','overlay',{sticker:s.id,y:.5,size:280})]})])),[]);
 return <div className="library"><p className="library-hint">Click to add at the playhead, or drag onto the timeline.</p>
  {STICKER_GROUPS.map(group=><React.Fragment key={group}><h4>{group}</h4><div className="library-grid sticker-grid">{STICKERS.filter(s=>s.group===group).map(s=><Tile key={s.id} name={s.name} drop={{kind:'sticker',id:s.id}} disabled={p.disabled} onAdd={p.onAdd}><EngineTile edit={edits.get(s.id)!} rest={1.2} loop={2.4} background="#2b2b2e"/></Tile>)}</div></React.Fragment>)}</div>;
}

const CAPTION_STYLES=[{id:'clean',name:'Clean',about:'A line of the words in a box.'},{id:'karaoke',name:'Karaoke',about:'The word being said lights up.'},{id:'word_pop',name:'Word pop',about:'One word at a time.'},{id:'emphasis',name:'Emphasis',about:'Words you mark stand out.'}] as const;
/** Caption styles: captions follow the speech you hear; pick how they look, or turn them off. */
export function CaptionsView(p:{disabled:boolean;current?:string;onChoose:(style:string|null)=>void}){
 return <div className="library"><p className="library-hint">Captions follow the speech in your clips (as soon as it is transcribed). Pick a style, then edit words by selecting them on the Captions row.</p>
  <div className="caption-styles">{CAPTION_STYLES.map(s=><button key={s.id} type="button" className="caption-style" aria-pressed={p.current===s.id} disabled={p.disabled} onClick={()=>p.onChoose(s.id)}>
   <span className={'caption-demo demo-'+s.id}><b>Make</b> <i>it</i> <b>pop</b></span><strong>{s.name}</strong><small>{s.about}</small></button>)}
   {p.current&&<button type="button" className="prop-link" disabled={p.disabled} onClick={()=>p.onChoose(null)}>Turn captions off</button>}</div></div>;
}
