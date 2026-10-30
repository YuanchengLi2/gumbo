/// <reference types="chrome" />
import {fieldOf,inPaymentFrame,type Field} from './fields/field';
import {snapshot} from './fields/text';
import {readContext} from './context';
import {deepActive,pathOf,squash} from './dom';
import {post} from './port';
import {readPage,contentRoot,blocksOf,changed} from './facts';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
/** What memory keeps from a page, handed to the engine (which seals it): the user's own writing when a field is left or
 * sent, the page's text and facts once it has been read for a moment and again when its content changes, how long it
 * was in view, and what was copied. Never from sensitive fields (they are not fields), payment frames, or where Gumbo is
 * off. */
let settings:Settings|undefined;
const active=()=>!!settings&&activeOn(settings,location.hostname)&&!inPaymentFrame();
const keyOf=(field:Field)=>location.origin+location.pathname+'|'+(field.el.id||field.el.getAttribute('name')||pathOf(field.el));

export function startCapture(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;});
 let editing:Field|null=null;
 document.addEventListener('focusin',()=>{editing=fieldOf(deepActive());},true);
 document.addEventListener('focusout',()=>{if(editing)keepWriting(editing);editing=null;},true);
 // Sent with Enter (a chat, a prompt, a search): the field empties right after, so its text is kept now.
 document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){const field=fieldOf(deepActive());if(field&&(field.singleLine||['chat','prompt','search','comment'].includes(readContext(field).intent)))keepWriting(field);}},true);
 document.addEventListener('submit',event=>{for(const el of (event.target as HTMLFormElement).querySelectorAll('input,textarea,[contenteditable=true]')){const field=fieldOf(el);if(field)keepWriting(field);}},true);
 document.addEventListener('copy',()=>{if(!active())return;const text=squash(document.getSelection()?.toString()??'');if(text.length>=3)post({type:'capture.copy',text:text.slice(0,2000)});},true);
 if(window===window.top)watchPage();
}
function keepWriting(field:Field){
 if(!active())return;const snap=snapshot(field,1e9,1e9);if(!snap)return;
 const context=readContext(field);
 const last=context.thread?.at(-1);
 post({type:'capture.writing',key:keyOf(field),intent:context.intent,label:context.label,editor:field.editor,text:snap.text,replyTo:last?`${last.author?last.author+': ':''}${last.text.slice(0,300)}`:undefined});
}
/** The page's text and its facts, once it has been on screen for a few seconds, and again when its content changed (a
 * new email opened in an app that never reloads, a feed that grew, a new address); how long it was in view, when it is
 * left. Content changed means its blocks of text did (content/facts.ts changed), not its length. */
function watchPage(){
 let url=location.href,sent:Map<number,number>|undefined,visibleSince=document.visibilityState==='visible'?Date.now():0,timer:number|undefined,lastRead=0;
 const page=()=>readPage(contentRoot(),{except:fieldOf(deepActive())?.el});
 const read=()=>{
  lastRead=Date.now();
  if(!active()||document.visibilityState!=='visible')return;
  const {text,lines,facts}=page();if(text.length<80)return;
  const blocks=blocksOf(lines);
  if(sent&&location.href===url&&!changed(sent,blocks))return;
  sent=blocks;post({type:'capture.page',title:document.title,text,facts,visibleMs:0});
 };
 const soon=(ms:number)=>{clearTimeout(timer);timer=window.setTimeout(read,ms);};
 soon(3000);
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&visibleSince){if(active()&&sent){const {text,facts}=page();post({type:'capture.page',title:document.title,text,facts,visibleMs:Date.now()-visibleSince});}visibleSince=0;}
  else if(document.visibilityState==='visible'){visibleSince=Date.now();soon(3000);}
 });
 // Apps change address without reloading, and open messages without changing it; feeds grow as they are read.
 setInterval(()=>{if(location.href!==url){url=location.href;sent=undefined;soon(2500);}else if(lastRead&&Date.now()-lastRead>30_000)read();},1500);
}
/** The readable text of the page: its main content when it has one, without its menus, banner and footer, fields,
 * scripts or Gumbo's own layer. */
export function pageText(max=200_000){return readPage(contentRoot(),{max,facts:false}).text;}
