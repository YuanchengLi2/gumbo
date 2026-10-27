/// <reference types="chrome" />
import {surface,layer,raise} from './ui/root';
import {elementById} from './perceive';
import {visible} from './dom';
import {post,alive} from './port';
import {TAKE_KEY} from './keys';
import type {Plan,PlanStep,Likely} from '../shared/plan';
/** Tab's guess at where they go next on a page, shown so quietly it is seen only when looked for. The engine ranks the
 * few elements they will most likely use next (from their trail, habits, memory, tabs and what is in view); here, as they
 * work, the one they are heading for is picked live: where their pointer is going (its direction and speed), where they
 * are typing, what is in view. It is marked by a faint line under it, only while they are active (moving or typing),
 * never while they scroll or read. Holding Alt shows what the likely moves are; Alt+Q makes the one marked. Every real
 * click is checked against the guess, so how often Tab is right is known (the popup shows it). */
type Candidate={el:Element;p:number;label:string;step:PlanStep};
let candidates:Candidate[]=[],best:Candidate|null=null,line:HTMLDivElement|null=null,peeks:HTMLDivElement[]=[];
let px=-1,py=-1,vx=0,vy=0,lastMove=0,lastKey=0,lastScroll=0,altDown=0,peeking=false;
const trail:{x:number;y:number;t:number}[]=[];

export function startGlow(){
 window.addEventListener('pointermove',e=>{
  if(!e.isTrusted||e.pointerType==='touch')return;
  const t=performance.now();trail.push({x:e.clientX,y:e.clientY,t});while(trail.length>2&&t-trail[0].t>140)trail.shift();
  const a=trail[0];if(a&&t-a.t>20){vx=(e.clientX-a.x)/(t-a.t);vy=(e.clientY-a.y)/(t-a.t);}
  px=e.clientX;py=e.clientY;lastMove=Date.now();schedule();
 },{capture:true,passive:true});
 window.addEventListener('keydown',e=>{
  if(!e.isTrusted||!alive())return;
  if(e.key==='Alt'&&!e.repeat){altDown=Date.now();setTimeout(()=>{if(altDown&&Date.now()-altDown>=170)peek();},180);return;}
  altDown=0;if(peeking)unpeek();
  if(!['Shift','Control','Meta','AltGraph'].includes(e.key))lastKey=Date.now();schedule();
 },true);
 // Holding Alt showed the labels: its release is kept from Chrome (a lone Alt would open Chrome's menu).
 window.addEventListener('keyup',e=>{if(e.key==='Alt'){const shown=peeking;altDown=0;unpeek();if(shown){e.preventDefault();e.stopImmediatePropagation();}}},true);
 window.addEventListener('scroll',()=>{lastScroll=Date.now();hideLine();},{capture:true,passive:true});
 window.addEventListener('blur',()=>{hideLine();unpeek();});
 // Their click, checked against the guess: was it where Tab said (the line), or among the likely moves?
 document.addEventListener('pointerdown',e=>{
  if(!e.isTrusted||e.button!==0||!candidates.length)return;
  const t=e.composedPath()[0];if(!(t instanceof Element))return;
  const on=(c:Candidate|null)=>!!c&&(c.el===t||c.el.contains(t));
  post({type:'predict.hit',hit:on(line?best:null),top:candidates.some(on),shown:!!line});
 },true);
 setInterval(()=>{if(line&&!active())hideLine();},500);
}
/** The engine's ranked guess for this moment (or nothing). */
export function setLikely(plan:Plan|null){
 unpeek();best=null;
 candidates=(plan?.likely??[]).map((l:Likely)=>({el:elementById(l.id),p:l.p,label:l.label,step:{do:l.do,id:l.id} as PlanStep})).filter((c):c is Candidate=>!!c.el&&visible(c.el));
 if(!candidates.length)hideLine();else update();
}
/** For the tests and debugging: the likely moves and the one marked or Alt+Q would make. */
export const glowState=()=>({likely:candidates.map(c=>`${c.label} (${c.p.toFixed(2)})`),marked:line&&best?best.label:undefined,now:takeNow()?.plan.label});
export function clearLikely(){candidates=[];best=null;hideLine();unpeek();}
/** Where their pointer is (for the engine: elements near it are where they are looking). */
export const pointerAt=()=>px<0?null:[px,py] as [number,number];
/** Whether the pointer is being moved now: only then does where it is say where they are heading (a pointer left resting
 * after a click says nothing). */
export const pointerMoving=()=>Date.now()-lastMove<1500;
/** Every likely move, in the order they rank as the pointer and typing stand now (for Alt and + to go through). */
export function likelyMoves():{plan:Plan;el:Element}[]{
 return rank().filter(r=>r.s>=FLOOR/2).map(r=>({plan:{label:r.c.label,confidence:r.c.p,steps:[r.c.step]},el:r.c.el}));
}
/** The move Alt+Q makes now: the guess as their pointer and typing stand at this moment. */
export function takeNow():{plan:Plan;el:Element}|null{
 const top=rank()[0];if(!top||top.s<FLOOR)return null;
 return{plan:{label:top.c.label,confidence:top.c.p,steps:[top.c.step]},el:top.c.el};
}

const FLOOR=0.1;
const active=()=>Date.now()-lastMove<1600||Date.now()-lastKey<2500;
let frame=0;const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update();});};
/** How likely each guess is now: the engine's likelihood, weighed by what they are doing this moment. */
function rank(){
 const now=Date.now(),speed=Math.hypot(vx,vy),moving=now-lastMove<250&&speed>0.2;
 const focus=document.activeElement&&document.activeElement!==document.body&&now-lastKey<4000?document.activeElement.getBoundingClientRect():null;
 return candidates.map(c=>{
  const r=c.el.getBoundingClientRect();if(!r.width||!r.height||!c.el.isConnected)return{c,s:0};
  const cx=r.left+r.width/2,cy=r.top+r.height/2,dx=cx-px,dy=cy-py,dist=Math.hypot(dx,dy);
  let w=r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth?1:0.15;
  if(px>=r.left&&px<=r.right&&py>=r.top&&py<=r.bottom)w*=3;
  else if(px>=0&&moving){const cos=(dx*vx+dy*vy)/((dist||1)*speed);w*=cos>0.92?3:cos>0.75?1.7:cos>0.35?0.8:0.25;}
  else if(px>=0)w*=1+0.8/(1+dist/250);
  // Typing in a field: what is beside it (its Send, its next field) is where they go when they stop.
  if(focus){const d=Math.hypot(cx-(focus.left+focus.width/2),cy-(focus.top+focus.height/2));w*=1+1.2/(1+d/220);}
  return{c,s:c.p*w};
 }).sort((a,b)=>b.s-a.s);
}
function update(){
 if(!candidates.length||!active()||Date.now()-lastScroll<500){hideLine();return;}
 const ranked=rank();let top=ranked[0];
 if(!top||top.s<FLOOR){best=null;hideLine();return;}
 // Steady: the mark moves to another guess only when that one clearly leads.
 const current=best?ranked.find(r=>r.c===best):undefined;if(current&&current!==top&&top.s<current.s*1.35)top=current;
 best=top.c;drawLine(best.el);
}
function drawLine(el:Element){
 layer();raise();
 if(!line){line=document.createElement('div');line.className='glow';surface().appendChild(line);}
 const r=el.getBoundingClientRect(),width=Math.min(r.width,360);
 Object.assign(line.style,{left:`${Math.round(r.left+(r.width-width)/2)}px`,top:`${Math.round(Math.min(r.bottom+2,innerHeight-3))}px`,width:`${Math.round(width)}px`});
}
function hideLine(){line?.remove();line=null;}
/** Alt held: the likely moves, each in a few words beside it; the one Alt+Q makes first. */
function peek(){
 if(!candidates.length||peeking)return;peeking=true;layer();raise();
 // Only what is on screen gets a label (one for something off screen would sit at the edge, over the page); and the
 // labels go by themselves, in case the Alt key's release never comes (the window lost the focus as it was held).
 const onScreen=(el:Element)=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;};
 const ranked=rank().filter(r=>r.s>0&&onScreen(r.c.el)).slice(0,3);setTimeout(unpeek,4000);
 ranked.forEach((r,i)=>{
  const tag=document.createElement('div');tag.className='move peek';
  if(i===0){const k=document.createElement('kbd');k.textContent=TAKE_KEY;tag.append(k);}
  const t=document.createElement('span');t.className='text';t.textContent=r.c.label;tag.append(t);surface().appendChild(tag);peeks.push(tag);
  const e=r.c.el.getBoundingClientRect(),b=tag.getBoundingClientRect();
  const left=e.right+8+b.width<=innerWidth-8?e.right+8:Math.max(8,e.left);
  const top=e.right+8+b.width<=innerWidth-8?e.top+(e.height-b.height)/2:e.top-b.height-4;
  Object.assign(tag.style,{left:`${Math.round(left)}px`,top:`${Math.round(Math.max(4,Math.min(top,innerHeight-b.height-4)))}px`});
 });
}
function unpeek(){peeking=false;for(const p of peeks)p.remove();peeks=[];}
