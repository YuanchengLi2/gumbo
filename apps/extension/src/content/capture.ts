/// <reference types="chrome" />
import {fieldOf,inPaymentFrame,type Field} from './fields/field';
import {snapshot} from './fields/text';
import {readContext} from './context';
import {deepActive,pathOf,squash} from './dom';
import {post} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
/** What memory keeps from a page, handed to the engine (which seals it): the user's own writing when a field is left or
 * sent, the page's text once it has been read for a moment and again when it changes a lot, how long it was in view,
 * and what was copied. Never from sensitive fields (they are not fields), payment frames, or where Gumbo is off. */
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
/** The page's text, once it has been on screen for a few seconds, and again when it changed a lot (a new address in an
 * app that never reloads, a feed that grew); how long it was in view, when it is left. */
function watchPage(){
 let url=location.href,sentLength=0,visibleSince=document.visibilityState==='visible'?Date.now():0,timer:number|undefined,lastRead=0;
 const read=()=>{
  lastRead=Date.now();
  if(!active()||document.visibilityState!=='visible')return;
  const text=pageText();if(text.length<80)return;
  if(Math.abs(text.length-sentLength)<Math.max(400,sentLength*0.25)&&location.href===url&&sentLength)return;
  sentLength=text.length;post({type:'capture.page',title:document.title,text,visibleMs:0});
 };
 const soon=(ms:number)=>{clearTimeout(timer);timer=window.setTimeout(read,ms);};
 soon(3000);
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&visibleSince){if(active()&&sentLength)post({type:'capture.page',title:document.title,text:pageText(),visibleMs:Date.now()-visibleSince});visibleSince=0;}
  else if(document.visibilityState==='visible'){visibleSince=Date.now();soon(3000);}
 });
 // Apps change address without reloading; feeds grow as they are read.
 setInterval(()=>{if(location.href!==url){url=location.href;sentLength=0;soon(2500);}else if(lastRead&&Date.now()-lastRead>30_000)read();},1500);
}
/** The readable text of the page: its main content when it has one, without navigation, scripts or Gumbo's own layer. */
export function pageText(max=200_000){
 const root=document.querySelector('main,article,[role=main]')??document.body;if(!root)return '';
 const text=(root as HTMLElement).innerText??'';
 return text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,max);
}
