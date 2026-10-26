/// <reference types="chrome" />
import {fieldOf,type Field} from './fields/field';
import {snapshot} from './fields/text';
import {caretOf} from './fields/caret';
import {insert} from './fields/insert';
import {readContext,type FieldContext} from './context';
import {showGhost,hideGhost,ghostShown} from './ui/ghost';
import {layer} from './ui/root';
import {deepActive,pathOf} from './dom';
import {post,listen,ask} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {remainder} from '../shared/suggestion';
/** Tab in a page. After a pause in typing (120 ms, longer on sites where suggestions are often ignored) it asks the engine
 * for what comes next and shows it as ghost text the moment the first whole word arrives. Typing the same letters keeps
 * the rest showing with no new request, and Backspace brings it back; Tab takes it all, Ctrl+→ one word, Esc dismisses.
 * Tab is only taken while a suggestion shows. Every suggestion's fate and the time to its first word are reported. */
type Live={id:string;field:Field;key:string;base:string;text:string;final:boolean;pausedAt:number;shownAt?:number;context:FieldContext;taken:number;reported:boolean};
let settings:Settings|undefined,live:Live|null=null,timer:number|undefined,seq=0,composing=false,lastInput=0;
let bar={debounceMs:120,minWords:1};
const cache=new Map<string,string>(),warmed=new Map<string,number>();
const active=()=>!!settings&&activeOn(settings,location.hostname);
const keyOf=(field:Field)=>location.origin+location.pathname+'|'+(field.el.id||field.el.getAttribute('name')||pathOf(field.el));
const editorOwnsTab=(field:Field)=>field.editor==='monaco'||field.editor==='codemirror';

export function startTab(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;if(!active())clear();});
 document.addEventListener('compositionstart',()=>{composing=true;clear();},true);
 document.addEventListener('compositionend',()=>{composing=false;},true);
 document.addEventListener('focusin',onFocus,true);
 document.addEventListener('input',onInput,true);
 document.addEventListener('keydown',onKey,true);
 document.addEventListener('selectionchange',onSelection);
 document.addEventListener('focusout',()=>setTimeout(()=>{if(live&&!fieldIsFocused(live.field))drop('ignored');},0),true);
 document.addEventListener('mousedown',()=>{if(live)drop('ignored');},true);
 window.addEventListener('scroll',()=>requestAnimationFrame(render),{capture:true,passive:true});
 window.addEventListener('resize',()=>requestAnimationFrame(render));
 listen(onAnswer);
}
const fieldIsFocused=(field:Field)=>{const a=deepActive();return !!a&&(a===field.el||field.el.contains(a));};

function onFocus(){
 if(!active())return;const field=fieldOf(deepActive());if(!field)return;
 const key=keyOf(field);if(Date.now()-(warmed.get(key)??0)<60_000)return;warmed.set(key,Date.now());
 // Wake the engine and warm the model's cache for this field while the user starts typing.
 post({type:'tab.prewarm',context:readContext(field)});
 void ask<{debounceMs:number;minWords:number}>({type:'tab.bar',site:location.hostname.replace(/^www\./,'')},'tab.bar',3000).then(b=>{if(b)bar={debounceMs:b.debounceMs,minWords:b.minWords};});
}

function onInput(event:Event){
 if(!active()||composing)return;
 const field=fieldOf(deepActive());if(!field){clear();return;}
 const snap=snapshot(field);if(!snap||snap.selected){clear();return;}
 lastInput=performance.now();
 // The suggestion still fits what is now before the caret: keep showing the rest, with no new request.
 if(live&&live.key===keyOf(field)){
  const rest=remainder(live.base,live.text,snap.before);
  if(rest){live.field=field;render();return;}
  // Typed through to the end: the user wrote exactly what was suggested.
  if(live.text&&snap.before===live.base+live.text){drop('accepted',live.text.length);}
  else drop('ignored');
 }
 clearTimeout(timer);hideGhost();
 const type=(event as InputEvent).inputType??'';
 if(type.startsWith('delete')||type==='insertFromPaste'||type==='historyUndo'||type==='historyRedo')return;
 // Right after a word ends, the next words are what the user is about to type: ask at once (a prediction that keeps
 // matching what they type is kept). Inside a word, wait for the pause.
 const boundary=/[^\s]\s$/.test(snap.before)&&bar.debounceMs<=120;
 timer=window.setTimeout(()=>void request(field),boundary?30:bar.debounceMs);
}

async function request(field:Field){
 if(!active()||composing||!fieldIsFocused(field))return;
 const snap=snapshot(field);if(!snap||snap.selected)return;
 // Only at the end of a word or line: mid-word, the word is the user's to finish.
 if(/^[\p{L}\p{N}]/u.test(snap.after))return;
 const words=snap.before.trim().split(/\s+/).filter(Boolean).length;if(words<bar.minWords)return;
 const key=keyOf(field),context=readContext(field),cached=cache.get(key+'|'+snap.before.slice(-160));
 if(live&&!live.final)post({type:'cancel',id:live.id});
 const id=`t${++seq}`;
 live={id,field,key,base:snap.before,text:'',final:false,pausedAt:lastInput||performance.now(),context,taken:0,reported:false};
 if(cached){live.text=cached;live.final=true;render();return;}
 post({type:'tab',id,context,before:snap.before,after:snap.after,text:snap.text.slice(-4000)});
}

function onAnswer(message:any){
 if(message?.type!=='tab.text'||!live||message.id!==live.id)return;
 if(message.text.length>=live.text.length||message.final)live.text=message.text;
 if(message.final){live.final=true;if(live.text)cache.set(live.key+'|'+live.base.slice(-160),live.text);if(cache.size>200)cache.delete(cache.keys().next().value!);}
 if(!live.text){if(message.final){hideGhost();live=null;}return;}
 render();
}
/** Draws what is left of the suggestion at the caret. */
function render(){
 if(!live||!live.text)return;
 const field=live.field;if(!fieldIsFocused(field)){drop('ignored');return;}
 const snap=snapshot(field);if(!snap)return;
 const rest=remainder(live.base,live.text,snap.before);if(!rest){hideGhost();return;}
 layer();const caret=caretOf(field);
 if(!caret){post({type:'failure',site:location.hostname,editor:field.editor,what:'placement',detail:'no caret position'});return;}
 showGhost(caret,rest,{atLineEnd:!snap.after||snap.after.startsWith('\n'),singleLine:field.singleLine,ownWrapping:field.kind==='context'});
 if(!live.shownAt){live.shownAt=performance.now();post({type:'tab.timing',ms:live.shownAt-live.pausedAt});}
}

function onKey(event:KeyboardEvent){
 if(!live||!live.text||!ghostShown()||event.isComposing)return;
 const field=live.field,snap=snapshot(field),rest=snap?remainder(live.base,live.text,snap.before):null;if(!rest)return;
 if(event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
  event.preventDefault();event.stopImmediatePropagation();void accept(field,rest,true);
 }else if(event.key==='ArrowRight'&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!editorOwnsTab(field)){
  event.preventDefault();event.stopImmediatePropagation();
  const word=/^\s*[^\s]+/.exec(rest)?.[0]??rest;void accept(field,word,word.length>=rest.length);
 }else if(event.key==='Escape'){
  event.preventDefault();event.stopImmediatePropagation();drop('dismissed');
 }
}
async function accept(field:Field,text:string,all:boolean){
 hideGhost();const current=live!;
 const result=await insert(field,text);
 if(!result.ok){
  post({type:'failure',site:location.hostname,editor:field.editor,what:'insert',detail:result.reason??'not inserted'});
  try{await navigator.clipboard.writeText(text);}catch{}
  drop('ignored');return;
 }
 current.taken+=text.length;
 if(all){drop(current.taken>=current.text.length?'accepted':'partial',current.taken);
  // Ready for what comes next, as if the user had paused after typing it.
  lastInput=performance.now();clearTimeout(timer);timer=window.setTimeout(()=>void request(field),Math.max(250,bar.debounceMs));}
 else if(live===current)render();
}
function onSelection(){
 if(!live||!live.text)return;
 const snap=snapshot(live.field);
 // The caret went somewhere the suggestion does not continue from.
 if(!snap||snap.selected||!remainder(live.base,live.text,snap.before))drop('ignored');
}
/** Ends the current suggestion, reporting once what became of it. */
function drop(outcome:'accepted'|'partial'|'ignored'|'dismissed',taken=0){
 const current=live;live=null;hideGhost();clearTimeout(timer);
 // A prediction still streaming is no longer wanted: stop the model.
 if(current&&!current.final)post({type:'cancel',id:current.id});
 if(!current||current.reported||!current.shownAt)return;current.reported=true;
 post({type:'tab.outcome',site:location.hostname.replace(/^www\./,''),intent:current.context.intent,kind:'text',text:current.text,accepted:taken||current.taken,outcome:current.taken&&outcome==='ignored'?'partial':outcome,latencyMs:current.shownAt-current.pausedAt});
}
function clear(){if(live)drop('ignored');clearTimeout(timer);hideGhost();}
/** What Tab is showing now (for the engine's checks and the tests). */
export function tabState(){
 if(!live)return{showing:false};
 const snap=snapshot(live.field),rest=snap?remainder(live.base,live.text,snap.before):null;
 return{showing:ghostShown()&&!!rest,rest,text:live.text,final:live.final};
}
