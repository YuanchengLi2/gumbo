/// <reference types="chrome" />
import {takes,took} from './keys';
import {fieldOf,hiddenBox,type Field} from './fields/field';
import {insert} from './fields/insert';
import {deepActive} from './dom';
import {post,ask as request,alive} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {layer,raise} from './ui/root';
import {showGhost,hideGhost} from './ui/ghost';
/** Tab for text in a drawn editor (Google Docs, Slides, a design tool's text): the user types into a hidden box that holds
 * none of their words, so at a pause the engine reads a picture of the view with the caret marked, and the words it
 * predicts show beside the caret (drawn by the page itself, since the box may sit in a frame one pixel tall). Tab types
 * them through the box; any other key, a click or the box losing the focus drops them. */
let settings:Settings|undefined,timer:number|undefined,seq=0,shown:{text:string;el:Element}|undefined;
/** What they typed since the caret was last placed: the words just before it, which the picture shows but code cannot
 * read, so the suggestion meets them exactly (a space where one is needed, a half-typed word finished). */
let typed='';
const active=()=>!!settings&&activeOn(settings,location.hostname);

export function startDrawnTab(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;if(!active())drop();});
 // Before Tab for actions and the page: Tab here means "take these words".
 window.addEventListener('keydown',onKey,true);
 document.addEventListener('focusout',()=>{drop();typed='';},true);
 // The page showing the words: a press or a scroll anywhere puts them away.
 window.addEventListener('pointerdown',hideDrawnWords,true);window.addEventListener('scroll',hideDrawnWords,{capture:true,passive:true});
}
const hiddenField=()=>{const f=fieldOf(deepActive());return f&&hiddenBox(f)?f:null;};

function onKey(event:KeyboardEvent){
 if(!alive())return;
 if(!event.isTrusted||event.isComposing||!active())return;
 const field=hiddenField();if(!field)return;
 if(takes(event)&&shown?.el===field.el){
  took(event);
  const text=shown.text;drop();typed=(typed+text).slice(-300);void typeInto(field,text);return;
 }
 // A modifier pressed alone (the Alt of Alt+Q on its way) changes nothing yet.
 if(['Alt','AltGraph','Control','Shift','Meta'].includes(event.key))return;
 drop();
 if(event.ctrlKey||event.metaKey||event.altKey||(event.key.length!==1&&event.key!=='Backspace'&&event.key!=='Enter')){if(event.key.startsWith('Arrow')||event.key==='Home'||event.key==='End')typed='';return;}
 typed=(event.key==='Backspace'?typed.slice(0,-1):typed+(event.key==='Enter'?'\n':event.key)).slice(-300);
 // A pause in the typing is the moment; a finished sentence is answered sooner.
 timer=window.setTimeout(()=>void suggest(field),/[.!?]/.test(event.key)?300:650);
}

/** The words go in as real typing when the user turned it on (editors such as Docs and Canva may ignore anything else),
 * else through the box as a paste or typed text. */
export async function typeInto(field:Field|null,text:string){
 if(settings?.realInput){const real=await request<{ok:boolean}>({type:'input.insert',text},'input.inserted',6000);if(real?.ok)return true;}
 return field?(await insert(field,text)).ok:false;
}
async function suggest(field:Field){
 if(hiddenField()?.el!==field.el)return;
 const caret=caretInPage(field);if(!caret)return;
 const id=`d${++seq}`,mine=seq;asking=id;
 const answer=await request<{text:string}>({type:'tab.drawn',id,caret,typed,view:pageView(),title:pageTitle()},'tab.drawn',10_000);
 if(asking===id)asking=undefined;
 // Typed on, clicked away or moved since: the words are for a moment that has passed.
 if(!answer?.text||mine!==seq||hiddenField()?.el!==field.el)return;
 shown={text:answer.text,el:field.el};
 post({type:'tab.drawnShow',text:answer.text,caret});
}
/** The words, and a guess still on its way (it stops, and costs nothing more), are put away. */
let asking:string|undefined;
function drop(){
 clearTimeout(timer);seq++;
 if(asking){post({type:'cancel',id:asking});asking=undefined;}
 if(shown){shown=undefined;post({type:'tab.drawnHide'});}
}

/** The caret in the page's own pixels: the hidden box sits at it, and so does a frame it is in (Docs moves its one-pixel
 * frame with the caret). Line height is not known, so a usual one is taken. */
function caretInPage(field:Field):[number,number,number]|null{
 const r=field.el.getBoundingClientRect();let x=r.left,y=r.top,w:Window=window;
 try{
  while(w!==w.top){const frame=w.frameElement;if(!frame)return null;const f=frame.getBoundingClientRect();x+=f.left;y+=f.top;w=w.parent;}
 }catch{return null;}
 return[Math.round(x),Math.round(y),Math.max(18,Math.min(40,Math.round(r.height)))];
}
/** In the page: the words under the caret, with Tab beside them (the editor's font and size are in the drawing, so they
 * are not set in it as ghost text). */
let words:string|undefined;
export function showDrawnWords(text:string,[x,top,height]:[number,number,number]){
 layer();raise();words=text;
 showGhost({x,top,height,left:x,right:innerWidth-12,bottom:top+height,font:{family:'system-ui',size:'14px',weight:'400',style:'normal',letterSpacing:'normal',wordSpacing:'normal',lineHeight:'normal',textTransform:'none',color:'#000',tabSize:'4'},direction:'ltr',scale:1,background:'transparent',whiteSpace:'pre-wrap'},text,{atLineEnd:false,singleLine:true});
}
export function hideDrawnWords(){if(words===undefined)return;words=undefined;hideGhost();}
export const drawnWords=()=>words;
const pageView=():[number,number]=>{try{return[window.top!.innerWidth,window.top!.innerHeight];}catch{return[innerWidth,innerHeight];}};
const pageTitle=()=>{try{return window.top!.document.title;}catch{return document.title;}};
