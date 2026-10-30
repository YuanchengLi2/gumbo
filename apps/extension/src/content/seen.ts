/// <reference types="chrome" />
import {post} from './port';
import {fieldOf,inPaymentFrame} from './fields/field';
import {snapshot} from './fields/text';
import {readContext} from './context';
import {deepActive,squash,visible,SKIP} from './dom';
import {readPage,contentRoot} from './facts';
import type {Fact} from '../shared/facts';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {categoryOf,type PageSigns} from '../shared/page-kind';
import {deepQuery} from './perceive';
/** What memory knows of this page right now, and what of it was actually read (the top page only):
 * - read: the page's blocks of text (paragraphs, list items, headings, cells) are watched as they come and go from view;
 *   each second the tab is in front and the user is about (moved, typed, scrolled in the last minute), the blocks at least
 *   half on screen count a second more. Every few seconds what was read since goes to memory (memory/live.ts), which adds
 *   it to the page's passages when the visit ends.
 * - now: the words in view, the field in focus (its label, what it is for, the last words typed), the selection, how far
 *   down the page, what kind of page it is, and the facts on it (content/facts.ts, read again as the page changes, every
 *   five seconds at most); sent when it changed, at most once a second.
 * It costs the page next to nothing: one IntersectionObserver, new blocks picked up when the page has been quiet, the
 * work done when the browser is idle. Never inside fields being written (that is writing), Gumbo's own layer, sensitive
 * fields (they are not fields), payment frames, or where Gumbo is off. */
const BLOCKS='p,li,h1,h2,h3,h4,blockquote,pre,td,dd,figcaption,[role=listitem],[role=article],[role=row]';
// A long feed or thread is recorded as it is scrolled through, not only its first screens.
const MAX_BLOCKS=1500;
let settings:Settings|undefined,io:IntersectionObserver|undefined,observed=0,lastInput=Date.now(),lastNow='',lastSent=0,nowTimer:number|undefined,signs:Partial<PageSigns>={},signsAt=0,facts:Fact[]=[];
const watched=new WeakSet<Element>(),inView=new Set<Element>(),dwell=new Map<Element,{ms:number;sent:number}>();
const active=()=>!!settings&&activeOn(settings,location.hostname)&&!inPaymentFrame();
const idle=(work:()=>void,timeout=2000)=>{if(typeof requestIdleCallback==='function')requestIdleCallback(()=>work(),{timeout});else setTimeout(work,50);};

export function startSeen(){
 // Every frame records what it shows (an embedded lesson, an email body, a document in a frame); what is on screen now
 // (the 'now' message) is the top page's alone.
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
  if(!looking()||!active())return;
  for(const el of inView){if(!el.isConnected){inView.delete(el);continue;}const d=dwell.get(el)??{ms:0,sent:0};d.ms+=1000;dwell.set(el,d);}
 },1000);
 setInterval(()=>idle(()=>{flush();record();}),RECORD_MS);
 // Leaving the tab: what it shows now is what the next tab may need (a chat's answer, a lesson), so it goes at once.
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){sendNow(true);flush();record(true);}else nowSoon();});
 window.addEventListener('pagehide',()=>{flush();record(true);});
}
/** The user is looking at this: the tab is in front of a focused window (a frame cannot tell, so it counts while shown)
 * and they moved, typed or scrolled in the last minute. */
const looking=()=>document.visibilityState==='visible'&&(window!==window.top||document.hasFocus())&&Date.now()-lastInput<60_000;
/** Memory is a recording of what was on the user's screen: every few seconds, each block of text that has been in view
 * for a second while they looked (as they scroll, as they switch to the tab, as the page changes under them) is
 * recorded once, in page order; so are images' words (alt text, captions), and on a page whose words are not in blocks
 * (a chat's messages, an app's cards) what is in view. When the screen is mostly pictures or drawn as pixels (a scan, a
 * sheet, a design), the engine is told, and reads the picture (background/memory/record.ts). Cheap: it reads only what
 * the screen watcher already watches, when the browser is idle. */
const RECORD_MS=4000,recorded=new Set<string>();let recordedOn=location.href,lastPixels='';
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36)+s.length;};
function record(leaving=false){
 if(!active()||!leaving&&!looking())return;
 if(location.href!==recordedOn){recordedOn=location.href;recorded.clear();}
 const keep=(text:string,into:string[])=>{const t=text.trim();if(t.length<3)return;const k=hash(t);if(recorded.has(k))return;recorded.add(k);into.push(t);};
 const blocks:string[]=[],els=[...dwell].filter(([el,d])=>d.ms>=1000&&el.isConnected).map(([el])=>el).sort(above);
 for(const el of els)keep(squash((el as HTMLElement).innerText??'').slice(0,4000),blocks);
 // A page whose words are not in paragraphs: what is in view, read from its text directly.
 if(!els.length&&!leaving)keep(inViewText(3000),blocks);
 // Images in view: their words, and whether the screen is mostly pictures.
 let pictured=0;const area=innerWidth*innerHeight;
 for(const img of deepQuery('img,canvas,svg[role=img],[role=img]',document,300)){
  const r=img.getBoundingClientRect(),w=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0)),h=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));
  if(w<120||h<80)continue;pictured+=w*h;
  const words=[img.getAttribute('alt'),img.getAttribute('aria-label'),img.getAttribute('title'),img.closest('figure')?.querySelector('figcaption')?.textContent].map(s=>squash(s??'')).filter(Boolean);
  if(words.length)keep(`[image] ${[...new Set(words)].join(' — ')}`,blocks);
 }
 const inViewWords=[...inView].reduce((n,el)=>n+((el as HTMLElement).innerText?.length??0),0);
 const pixels=window===window.top&&!leaving&&pictured>area*0.35&&inViewWords<600&&(()=>{const k=`${location.href}|${scrollY}|${Math.round(pictured/1000)}`;if(k===lastPixels)return false;lastPixels=k;return true;})();
 if(blocks.length||pixels)post({type:'record',title:document.title,blocks,pixels,view:[innerWidth,innerHeight]});
}
/** Picks up the blocks of text not watched yet (a page that renders late, a feed that grew), open shadow roots too. */
function scan(){
 if(!active()||!io||!document.body)return;
 for(const el of deepQuery(BLOCKS,document,6000)){
  if(observed>=MAX_BLOCKS)break;
  if(watched.has(el))continue;watched.add(el);
  // A block inside another (a paragraph in a list item) is read with it.
  if(el.closest(SKIP)||el.parentElement?.closest(BLOCKS))continue;
  const text=squash((el as HTMLElement).innerText??'');if(text.length<(/^H\d$/.test(el.tagName)?8:40))continue;
  io.observe(el);observed++;
 }
 if(Date.now()-signsAt>5000){signsAt=Date.now();signs=signsOf();facts=readPage(contentRoot(),{max:100_000,except:fieldOf(deepActive())?.el}).facts.slice(0,80);}
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
function sendNow(leaving=false){
 if(!active()||window!==window.top||!leaving&&document.visibilityState!=='visible')return;
 let words=[...inView].filter(el=>el.isConnected).sort(above).map(el=>squash((el as HTMLElement).innerText??'')).join('\n').slice(0,3000);
 // A page whose words are not in paragraphs (a chat's messages, an app's cards are plain boxes): what is in view, read
 // from its text directly.
 if(words.length<300)words=inViewText(3000)||words;
 const field=fieldOf(deepActive());let focus:{label:string;intent:string;typed?:string}|undefined;
 if(field){const context=readContext(field),snap=snapshot(field,300,0);focus={label:context.label,intent:context.intent,typed:snap?.before||undefined};}
 // A selection inside a field Gumbo may not touch (a password) is not read.
 const inField=deepActive() instanceof HTMLInputElement||deepActive() instanceof HTMLTextAreaElement;
 const selection=inField&&!field?undefined:squash(String(getSelection()??'')).slice(0,1000)||undefined;
 const now={title:document.title,visible:words,focus,selection,scroll:[Math.round(scrollY),document.documentElement.scrollHeight],kind:categoryOf(location.href,document.title,signs),facts:facts.length?facts:undefined};
 const json=JSON.stringify(now);if(json===lastNow)return;
 lastNow=json;lastSent=Date.now();post({type:'now',...now});
}
/** The text in view, in page order, whatever holds it (never fields, menus or Gumbo's own layer); at most 2,000 pieces. */
function inViewText(max:number){
 if(!document.body)return '';
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.textContent?.trim()&&!n.parentElement?.closest(`${SKIP},script,style,noscript,button,select,option,[aria-hidden=true]`)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
 const out:string[]=[];let size=0,seen=0,last:Element|null=null;
 for(let n=walker.nextNode();n&&seen<2000&&size<max;n=walker.nextNode(),seen++){
  const el=n.parentElement!;
  if(el!==last){const r=el.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight||r.width===0)continue;last=el;}
  const t=squash(n.textContent!);out.push(t);size+=t.length+1;
 }
 return out.join(' ').slice(0,max);
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
