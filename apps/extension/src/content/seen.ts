/// <reference types="chrome" />
import {post} from './port';
import {fieldOf,inPaymentFrame} from './fields/field';
import {snapshot} from './fields/text';
import {readContext} from './context';
import {deepActive,squash,visible} from './dom';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {categoryOf,type PageSigns} from '../shared/page-kind';
/** What memory knows of this page right now, and what of it was actually read (the top page only):
 * - read: the page's blocks of text (paragraphs, list items, headings, cells) are watched as they come and go from view;
 *   each second the tab is in front and the user is about (moved, typed, scrolled in the last minute), the blocks at least
 *   half on screen count a second more. Every few seconds what was read since goes to memory (memory/live.ts), which adds
 *   it to the page's passages when the visit ends.
 * - now: the words in view, the field in focus (its label, what it is for, the last words typed), the selection, how far
 *   down the page, and what kind of page it is; sent when it changed, at most once a second.
 * It costs the page next to nothing: one IntersectionObserver, new blocks picked up when the page has been quiet, the
 * work done when the browser is idle. Never inside fields being written (that is writing), Gumbo's own layer, sensitive
 * fields (they are not fields), payment frames, or where Gumbo is off. */
const BLOCKS='p,li,h1,h2,h3,h4,blockquote,pre,td,dd,figcaption,[role=listitem],[role=article],[role=row]';
const SKIP='nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[contenteditable=true],[contenteditable=""],textarea,gumbo-layer';
const MAX_BLOCKS=400;
let settings:Settings|undefined,io:IntersectionObserver|undefined,observed=0,lastInput=Date.now(),lastNow='',lastSent=0,nowTimer:number|undefined,signs:Partial<PageSigns>={},signsAt=0;
const watched=new WeakSet<Element>(),inView=new Set<Element>(),dwell=new Map<Element,{ms:number;sent:number}>();
const active=()=>!!settings&&activeOn(settings,location.hostname)&&!inPaymentFrame();
const idle=(work:()=>void,timeout=2000)=>{if(typeof requestIdleCallback==='function')requestIdleCallback(()=>work(),{timeout});else setTimeout(work,50);};

export function startSeen(){
 if(window!==window.top)return;
 void loadSettings().then(s=>{settings=s;idle(()=>{scan();nowSoon();});});onSettings(s=>{settings=s;});
 io=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting&&e.intersectionRatio>=0.5)inView.add(e.target);else inView.delete(e.target);}nowSoon();},{threshold:[0,0.5]});
 for(const type of ['pointermove','keydown','wheel','touchstart'])window.addEventListener(type,()=>{lastInput=Date.now();},{capture:true,passive:true});
 document.addEventListener('scroll',()=>{lastInput=Date.now();nowSoon();},{capture:true,passive:true});
 document.addEventListener('selectionchange',nowSoon);
 document.addEventListener('focusin',nowSoon,true);
 document.addEventListener('input',nowSoon,true);
 let scanned=0;
 new MutationObserver(()=>{if(Date.now()-scanned<2000)return;scanned=Date.now();idle(()=>{scan();nowSoon();});}).observe(document.documentElement,{childList:true,subtree:true});
 setInterval(()=>{
  if(document.visibilityState!=='visible'||!document.hasFocus()||Date.now()-lastInput>60_000||!active())return;
  for(const el of inView){if(!el.isConnected){inView.delete(el);continue;}const d=dwell.get(el)??{ms:0,sent:0};d.ms+=1000;dwell.set(el,d);}
 },1000);
 setInterval(()=>idle(flush),5000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();else nowSoon();});
 window.addEventListener('pagehide',flush);
}
/** Picks up the blocks of text not watched yet (a page that renders late, a feed that grew). */
function scan(){
 if(!active()||!io||!document.body)return;
 for(const el of document.body.querySelectorAll(BLOCKS)){
  if(observed>=MAX_BLOCKS)break;
  if(watched.has(el))continue;watched.add(el);
  // A block inside another (a paragraph in a list item) is read with it.
  if(el.closest(SKIP)||el.parentElement?.closest(BLOCKS))continue;
  const text=squash((el as HTMLElement).innerText??'');if(text.length<(/^H\d$/.test(el.tagName)?8:40))continue;
  io.observe(el);observed++;
 }
 if(Date.now()-signsAt>5000){signsAt=Date.now();signs=signsOf();}
}
function flush(){
 if(!active())return;
 const blocks:{text:string;ms:number}[]=[];
 for(const [el,d] of dwell){
  if(!el.isConnected&&d.ms===d.sent){dwell.delete(el);continue;}
  if(d.ms-d.sent<1000)continue;
  const text=squash((el as HTMLElement).innerText??'').slice(0,300);if(text)blocks.push({text,ms:d.ms-d.sent});d.sent=d.ms;
 }
 if(blocks.length)post({type:'seen',blocks});
}
function nowSoon(){
 if(nowTimer!==undefined||window!==window.top)return;
 nowTimer=window.setTimeout(()=>{nowTimer=undefined;idle(sendNow,500);},Math.max(0,1000-(Date.now()-lastSent)));
}
const above=(a:Element,b:Element)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;
function sendNow(){
 if(!active()||document.visibilityState!=='visible')return;
 const words=[...inView].filter(el=>el.isConnected).sort(above).map(el=>squash((el as HTMLElement).innerText??'')).join('\n').slice(0,3000);
 const field=fieldOf(deepActive());let focus:{label:string;intent:string;typed?:string}|undefined;
 if(field){const context=readContext(field),snap=snapshot(field,300,0);focus={label:context.label,intent:context.intent,typed:snap?.before||undefined};}
 // A selection inside a field Gumbo may not touch (a password) is not read.
 const inField=deepActive() instanceof HTMLInputElement||deepActive() instanceof HTMLTextAreaElement;
 const selection=inField&&!field?undefined:squash(String(getSelection()??'')).slice(0,1000)||undefined;
 const now={title:document.title,visible:words,focus,selection,scroll:[Math.round(scrollY),document.documentElement.scrollHeight],kind:categoryOf(location.href,document.title,signs)};
 const json=JSON.stringify(now);if(json===lastNow)return;
 lastNow=json;lastSent=Date.now();post({type:'now',...now});
}
/** A few signs of what kind of page this is, read without laying the page out. */
function signsOf():Partial<PageSigns>{
 const all=(s:string)=>[...document.querySelectorAll(s)];
 const root=document.querySelector('main,article,[role=main]')??document.body,text=root?.textContent??'';
 const big=(el:Element,w:number,h:number)=>{const r=el.getBoundingClientRect();return r.width>=w&&r.height>=h;};
 return{
  fields:all('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=search]),textarea,select').slice(0,60).filter(visible).length,
  textLength:text.length,
  editor:all('[contenteditable=true],[contenteditable=""]').some(el=>big(el,300,300)),
  video:all('video').some(v=>big(v,320,180)),
  rows:Math.min(500,document.querySelectorAll('[role=row],tr,[role=listitem]').length),
  price:/[$€£¥]\s?\d/.test(text.slice(0,20_000)),
  cart:all('button,[role=button],input[type=submit]').slice(0,300).some(b=>/add to (cart|bag|basket)|buy now/i.test(b.textContent||(b as HTMLInputElement).value||'')),
  composer:all('textarea,[contenteditable=true],[role=textbox]').some(el=>{const r=el.getBoundingClientRect();return r.width>200&&r.top>innerHeight*0.5&&r.top<innerHeight;}),
  messages:Math.min(200,document.querySelectorAll('[role=log] [role=listitem],[role=log] > *,[data-message-id]').length),
  charts:document.querySelectorAll('.recharts-wrapper,.highcharts-container,canvas[class*=chart i],svg[class*=chart i]').length,
  searchBox:!!document.querySelector('input[type=search],[role=search] input,input[name=q]'),
 };
}
