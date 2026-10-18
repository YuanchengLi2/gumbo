import React,{useMemo,useRef,useState} from 'react';
import {prepare,frameAt,textBounds,apply as applyMatrix,type TextLayer,type MediaLayer} from '@dream/compositor';
import {apply,resolve,itemClock,keyframeValues,type KeyframeProp,type Op,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {reason,setKeyframe} from '../../manual/model';

/** OpenCut's preview interaction: click the picture to select what is there (overlays, text and stickers before the main
 * track), drag a selected layer to move it, its corners to scale it and the knob above it to turn it. Positions snap to
 * the frame's centre lines. A drag shows live and is one undoable change; on an animated value it sets the keyframe at the
 * playhead. The outlines come from the same frame description the player and Export draw. */
type Box={id:string;item:boolean;corners:[number,number][];cx:number;cy:number;rotation:number};
type Gesture={id:string;mode:'move'|'scale'|'rotate';x:number;y:number;start:{x:number;y:number;scale:number;rotation:number};centre:[number,number];version:string;moved:boolean;ops:Op[]};
const inside=(pt:[number,number],poly:[number,number][])=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if(yi>pt[1]!==yj>pt[1]&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi||1e-9)+xi)hit=!hit;}return hit;};

export function PreviewHandles(p:{timeline:TimelineDocument;base:TimelineDocument;versionId:string;footage:FootageIndex;frame:number;selected:string[];locked:boolean;lockedReason:string;onSelect:(ids:string[])=>void;onPreview:(t:TimelineDocument|null)=>void;onApply:(ops:Op[],label:string,version?:string)=>Promise<unknown>;onError:(text:string)=>void}){
 const t=p.timeline,{width:W,height:H,fps}=t.settings,time=p.frame/fps,svg=useRef<SVGSVGElement>(null),gesture=useRef<Gesture|null>(null),[guides,setGuides]=useState<{x:boolean;y:boolean}>({x:false,y:false});
 const prepared=useMemo(()=>prepare({timeline:t,footage:p.footage}),[t,p.footage]);
 const boxes=useMemo(()=>{const frame=frameAt(prepared,time),out:Box[]=[],items=new Set(t.attached.map(i=>i.id));
  for(const layer of frame.layers){
   if(layer.kind==='media'){const l=layer as MediaLayer,r=l.rect,corners=([[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]] as [number,number][]).map(([x,y])=>[...applyMatrix(l.transform,x,y)] as [number,number]);
    const [cx,cy]=applyMatrix(l.transform,r.x+r.w/2,r.y+r.h/2);out.push({id:l.key,item:items.has(l.key),corners,cx,cy,rotation:Math.atan2(l.transform[1],l.transform[0])*180/Math.PI});}
   else if(layer.kind==='text'&&items.has((layer as TextLayer).key)){const l=layer as TextLayer,b=textBounds(l,W,H);if(!b)continue;const a=l.rotation*Math.PI/180,c=Math.cos(a)*l.scale,s=Math.sin(a)*l.scale;
    const corners=([[-b.w/2,-b.h/2],[b.w/2,-b.h/2],[b.w/2,b.h/2],[-b.w/2,b.h/2]] as [number,number][]).map(([x,y])=>[b.cx+x*c-y*s,b.cy+x*s+y*c] as [number,number]);out.push({id:l.key,item:true,corners,cx:b.cx,cy:b.cy,rotation:l.rotation});}}
  return out;},[prepared,time,t.attached,W,H]);
 const selected=boxes.find(b=>p.selected.length===1&&b.id===p.selected[0]);
 const point=(e:React.PointerEvent):[number,number]=>{const r=svg.current!.getBoundingClientRect();return[(e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H];};
 const pxPerFrame=()=>svg.current!.getBoundingClientRect().width/W;

 /** The current values of an item at the playhead, and the change that sets new ones (keyframes where animated). */
 const valuesOf=(id:string)=>{const raw=p.base.attached.find(i=>i.id===id);if(!raw)return;const placed=resolve(p.base,p.footage).items.find(i=>i.id===id);if(!placed)return;
  const sec=itemClock(placed,Math.max(placed.timelineStart,Math.min(placed.timelineEnd-1/fps,time))),keys=keyframeValues(raw.keyframes,sec),q=raw.params as Record<string,unknown>;
  const get=(prop:KeyframeProp,fallback:number)=>keys[prop]??Number(q[prop]??fallback);
  const text=!raw.source;return{raw,sec,values:{x:get('x',.5),y:get('y',text&&raw.component!=='title_card'?.8:.5),scale:get('scale',1),rotation:get('rotation',0)}};};
 const opsFor=(id:string,changes:Partial<Record<'x'|'y'|'scale'|'rotation',number>>):Op[]=>{const v=valuesOf(id);if(!v)return[];let keys=v.raw.keyframes;const params:Record<string,unknown>={...v.raw.params};let keyed=false,still=false;
  for(const [prop,value] of Object.entries(changes) as [KeyframeProp,number][]){if((keys??[]).some(k=>k[prop]!==undefined)){keys=setKeyframe(keys,v.sec,prop,value,fps);keyed=true;}else{params[prop]=value;still=true;}}
  return[...(still?[{type:'update_item' as const,itemId:id,changes:{params},reason}]:[]),...(keyed?[{type:'set_keyframes' as const,id,keyframes:keys!,reason}]:[])];};

 function down(e:React.PointerEvent<SVGSVGElement>){if(e.button!==0)return;const pt=point(e),handle=(e.target as SVGElement).dataset?.handle;
  const hit=handle&&selected?selected:[...boxes].reverse().find(b=>b.item&&inside(pt,b.corners))??[...boxes].reverse().find(b=>inside(pt,b.corners));
  if(!hit){p.onSelect([]);return;}
  if(!p.selected.includes(hit.id)||p.selected.length>1)p.onSelect([hit.id]);
  if(!hit.item)return;if(p.locked){p.onError(p.lockedReason);return;}
  const v=valuesOf(hit.id);if(!v)return;e.currentTarget.setPointerCapture(e.pointerId);
  gesture.current={id:hit.id,mode:handle==='rotate'?'rotate':handle?'scale':'move',x:pt[0],y:pt[1],start:v.values,centre:[hit.cx,hit.cy],version:p.versionId,moved:false,ops:[]};}
 function move(e:React.PointerEvent<SVGSVGElement>){const g=gesture.current;if(!g)return;const pt=point(e);if(!g.moved&&Math.hypot(pt[0]-g.x,pt[1]-g.y)*pxPerFrame()<3)return;g.moved=true;
  let changes:Partial<Record<'x'|'y'|'scale'|'rotation',number>>;
  if(g.mode==='move'){let x=g.start.x+(pt[0]-g.x)/W,y=g.start.y+(pt[1]-g.y)/H;const near=8/pxPerFrame(),snapX=!e.altKey&&Math.abs(x-.5)*W<near,snapY=!e.altKey&&Math.abs(y-.5)*H<near;if(snapX)x=.5;if(snapY)y=.5;setGuides({x:snapX,y:snapY});changes={x:Math.round(x*1e4)/1e4,y:Math.round(y*1e4)/1e4};}
  else if(g.mode==='scale'){const d0=Math.hypot(g.x-g.centre[0],g.y-g.centre[1]),d1=Math.hypot(pt[0]-g.centre[0],pt[1]-g.centre[1]);changes={scale:Math.max(.05,Math.min(20,Math.round(g.start.scale*d1/Math.max(1,d0)*1000)/1000))};}
  else{const a0=Math.atan2(g.y-g.centre[1],g.x-g.centre[0]),a1=Math.atan2(pt[1]-g.centre[1],pt[0]-g.centre[0]);let r=g.start.rotation+(a1-a0)*180/Math.PI;if(e.shiftKey)r=Math.round(r/15)*15;changes={rotation:Math.round(r*10)/10};}
  try{g.ops=opsFor(g.id,changes);if(g.ops.length)p.onPreview(apply(p.base,g.ops,p.footage));}catch{}}
 function up(){const g=gesture.current;gesture.current=null;setGuides({x:false,y:false});if(!g?.moved||!g.ops.length)return;
  void Promise.resolve(p.onApply(g.ops,g.mode==='move'?'Move on the preview':g.mode==='scale'?'Scale on the preview':'Rotate on the preview',g.version)).catch(error=>p.onError((error as Error).message)).finally(()=>p.onPreview(null));}

 const s=1/Math.max(.05,(svg.current?.getBoundingClientRect().width??W)/W);
 const knob=selected&&(()=>{const [a,b]=selected.corners,mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=mx-selected.cx,dy=my-selected.cy,len=Math.hypot(dx,dy)||1;return{x:mx+dx/len*26*s,y:my+dy/len*26*s,mx,my};})();
 return <svg ref={svg} className="preview-handles" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Select and move on the preview">
  {guides.x&&<line x1={W/2} x2={W/2} y1={0} y2={H} className="preview-guide" strokeWidth={s}/>}{guides.y&&<line x1={0} x2={W} y1={H/2} y2={H/2} className="preview-guide" strokeWidth={s}/>}
  {selected&&<g className={'preview-selection'+(selected.item?'':' main')}>
   <polygon points={selected.corners.map(c=>c.join(',')).join(' ')} strokeWidth={1.5*s}/>
   {selected.item&&<>{selected.corners.map((c,n)=><rect key={n} data-handle={'corner'+n} x={c[0]-5*s} y={c[1]-5*s} width={10*s} height={10*s} rx={2*s} strokeWidth={1.5*s}/>)}
    {knob&&<><line x1={knob.mx} y1={knob.my} x2={knob.x} y2={knob.y} strokeWidth={1.5*s}/><circle data-handle="rotate" cx={knob.x} cy={knob.y} r={6*s} strokeWidth={1.5*s}/></>}</>}
  </g>}
 </svg>;
}
