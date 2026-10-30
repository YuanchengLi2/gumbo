/// <reference types="chrome" />
import {takes,took,cycles,offers,mayTake} from './keys';
import {fieldOf,hiddenBox,type Field} from './fields/field';
import {snapshot} from './fields/text';
import {caretOf} from './fields/caret';
import {insert,type Inserted} from './fields/insert';
import {readContext,type FieldContext} from './context';
import {showGhost,hideGhost,ghostShown,showHint} from './ui/ghost';
import {layer} from './ui/root';
import {deepActive,pathOf} from './dom';
import {post,listen,ask,alive} from './port';
import {textDone,moveSince,wordsShown,wordsYield} from './bus';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {remainder,join} from '../shared/suggestion';
/** Tab in a page, as it types:
 * - Every keystroke first tries the suggestion showing (or one of its alternatives): typing the same letters keeps the
 *   rest, with no new request; typing the way an alternative goes switches to it.
 * - Otherwise the next one is asked at a word's end (a space, punctuation, a new line) with no pause, or inside a word
 *   once the typing pauses (120 ms) and 300 ms after the last request: about one request per word. A request on its way
 *   whose text the typing still extends is kept, and what it brings is cut to what is still ahead.
 * - The instant answer comes first (quick.ts: the word being typed finished, their own usual phrase, a fact the field
 *   asks for), the model's replaces it.
 * - Ahead of time: the moment a suggestion is whole, what comes after it is asked too and kept, so taking it (or typing
 *   through it) shows the next part at once.
 * - Tab takes it all, Ctrl+→ one word, Tab held with 1 goes to another way to go on, Esc dismisses. A fact
 *   taken from memory shows where it came from.
 * - An empty field asks once as it is focused: what goes in it, shown only when a fact from their context is behind it.
 * - One offer at a time (bus.ts): the ghost gives way to a move much surer than it, and a move that only types into this
 *   field is shown here as words.
 * Every suggestion's fate, how it was served (kept, instant, model, a move's words) and the time to show it are reported. */
type Live={id:string;field:Field;key:string;base:string;text:string;alts:string[];final:boolean;pausedAt:number;shownAt?:number;context:FieldContext;taken:number;reported:boolean;
 from:'model'|'cache'|'local'|'move';source?:{title:string;when:string};used?:string[];
 /** How sure the model was that this is what they type next (0 to 1), when it said. */confidence?:number;
 /** The ways to go on, in the order Tab+1 goes through them, once the user started going through them. */options?:string[];
 /** The text is finished once this is typed: the next step is a move, not more words. */done?:boolean};
type Kept={text:string;alts:string[];source?:{title:string;when:string};used?:string[];done?:boolean};
let settings:Settings|undefined,live:Live|null=null,timer:number|undefined,seq=0,composing=false,accepting=false,lastInput=0,lastRequest=0,lastAnswer=0;
let bar={debounceMs:120,minWords:1};
/** How long after the last request a new one may go while a word is being typed (shared/memory-config.ts text.requestGapMs). */
const GAP=100,PAUSE=30;
const cache=new Map<string,Kept>(),warmed=new Map<string,number>(),chained=new Map<string,string>();
const active=()=>!!settings&&activeOn(settings,location.hostname);
const keyOf=(field:Field)=>location.origin+location.pathname+'|'+(field.el.id||field.el.getAttribute('name')||pathOf(field.el));
const cacheKey=(key:string,before:string)=>key+'|'+before.slice(-160);
const editorOwnsTab=(field:Field)=>field.editor==='monaco'||field.editor==='codemirror';

export function startTab(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;if(!active())clear();});
 document.addEventListener('compositionstart',()=>{composing=true;clear();},true);
 document.addEventListener('compositionend',()=>{composing=false;},true);
 document.addEventListener('focusin',onFocus,true);
 document.addEventListener('input',onInput,true);
 document.addEventListener('keydown',onKey,true);
 offers('text',()=>!!live?.text&&ghostShown()&&!editorOwnsTab(live.field));
 document.addEventListener('selectionchange',onSelection);
 document.addEventListener('focusout',()=>setTimeout(()=>{if(live&&!fieldIsFocused(live.field))drop('ignored');},0),true);
 document.addEventListener('mousedown',()=>{if(live)drop('ignored');},true);
 window.addEventListener('scroll',()=>requestAnimationFrame(render),{capture:true,passive:true});
 window.addEventListener('resize',()=>requestAnimationFrame(render));
 listen(onAnswer);
 wordsYield(()=>{if(live)drop('ignored');},offerMoveWords);
}
/** A move that would type into the field the user is in, offered as ghost words at the caret: what it types that the
 * field does not hold yet (its whole value when the field is empty, the rest of it when they started it, after their
 * words when it adds to them). */
function offerMoveWords(el:Element,text:string,confidence:number,why?:string):boolean{
 const field=fieldOf(el);if(!field||!fieldIsFocused(field)||hiddenBox(field)||composing)return false;
 const snap=snapshot(field);if(!snap||snap.selected||!text.trim())return false;
 if(snap.text.includes(text.trim()))return false;
 const rest=text.startsWith(snap.before)&&!snap.after.trim()?text.slice(snap.before.length):join(snap.before,text);if(!rest.trim())return false;
 if(live)drop('ignored');
 live={id:`w${++seq}`,field,key:keyOf(field),base:snap.before,text:rest,alts:[],final:true,pausedAt:performance.now(),context:readContext(field),taken:0,reported:false,from:'move',confidence,done:true,source:why?{title:why.slice(0,60),when:'now'}:undefined};
 render();return true;
}
const fieldIsFocused=(field:Field)=>{const a=deepActive();return !!a&&(a===field.el||field.el.contains(a));};

function onFocus(){
 if(!alive())return;
 if(!active())return;const field=fieldOf(deepActive());if(!field||hiddenBox(field))return;
 const key=keyOf(field),cold=Date.now()-(warmed.get(key)??0)>=60_000;
 if(cold){
  warmed.set(key,Date.now());
  // Wake the engine, search memory for this field and warm the model's cache while the user starts typing.
  post({type:'tab.prewarm',context:readContext(field)});
  void ask<{debounceMs:number;minWords:number}>({type:'tab.bar',site:location.hostname.replace(/^www\./,'')},'tab.bar',3000).then(b=>{if(b)bar={debounceMs:b.debounceMs,minWords:b.minWords};});
 }
 // An empty field is the moment memory matters most (the amount from the invoice just read, the order number asked for):
 // what goes in it is asked each time it is entered empty (the answer is kept for these words, so again costs nothing), a
 // moment after the field's memory search has started.
 const snap=snapshot(field);if(snap&&!snap.text.trim())window.setTimeout(()=>{const now=snapshot(field);if(!live&&now&&!now.text.trim()&&fieldIsFocused(field))void request(field);},cold?60:0);
}

function onInput(event:Event){
 if(!alive())return;
 // What Gumbo itself is putting in the field is not the user's typing.
 if(!active()||composing||accepting)return;
 // A drawn editor's hidden typing box holds none of their words: there is nothing to continue from.
 const field=fieldOf(deepActive());if(!field||hiddenBox(field)){clear();return;}
 const snap=snapshot(field);if(!snap||snap.selected){clear();return;}
 lastInput=performance.now();
 if(live&&live.key===keyOf(field)){
  live.field=field;
  // The suggestion still fits what is now before the caret: keep showing the rest, with no new request.
  if(remainder(live.base,live.text,snap.before)){render();return;}
  // The typing went the way of an alternative: that one shows.
  const alt=live.alts.find(a=>remainder(live!.base,a,snap.before));
  if(alt){live.alts=[live.text,...live.alts.filter(a=>a!==alt)].filter(Boolean);live.text=alt;render();return;}
  // Typed through to the end: the user wrote exactly what was suggested, and what comes after it may be ready.
  if(live.text&&snap.before===live.base+live.text){const done=live.done;drop('accepted',live.text.length);if(done){textDone(field.el);return;}if(showKept(field,snap.before))return;}
  // Anything else is let go and the words as they are now are asked (a request still on its way is stopped). Keeping an
  // older request in the hope it still fit cost a second full round trip whenever it did not, the slowest suggestions.
  else drop('ignored');
 }
 clearTimeout(timer);hideGhost();
 const type=(event as InputEvent).inputType??'';
 if(type.startsWith('delete')||type==='insertFromPaste'||type==='historyUndo'||type==='historyRedo')return;
 // At a word's end, ask now; inside a word, only when the typing pauses (and, while the last request is still on its way,
 // not sooner than the gap after it): about one request per word typed, however fast.
 const since=performance.now()-lastRequest,boundary=/[\s.,;:!?)\]]$/.test(snap.before),waiting=lastAnswer<lastRequest;
 if(boundary)void request(field);
 else timer=window.setTimeout(()=>void request(field),waiting?Math.max(PAUSE,GAP-since):PAUSE);
}
/** Whether a suggestion (or one of its alternatives) still continues what is before the caret now. */
function fits(l:Live){const now=snapshot(l.field);if(!now)return false;if(now.before===l.base)return true;return !!l.text&&(!!remainder(l.base,l.text,now.before)||now.before===l.base+l.text||l.alts.some(a=>!!remainder(l.base,a,now.before)));}
/** What was asked ahead for exactly these words (a suggestion's continuation, an earlier answer): shown at once. */
function showKept(field:Field,before:string){
 const kept=cache.get(cacheKey(keyOf(field),before));
 // Known to be finished here: the move takes over.
 if(kept&&!kept.text&&kept.done){textDone(field.el);return true;}
 if(!kept?.text)return false;
 live={id:`k${++seq}`,field,key:keyOf(field),base:before,text:kept.text,alts:kept.alts,final:true,pausedAt:performance.now(),context:readContext(field),taken:0,reported:false,from:'cache',source:kept.source,used:kept.used,done:kept.done};
 render();chain(live);return true;
}
async function request(field:Field){
 if(!active()||composing||!fieldIsFocused(field))return;
 const snap=snapshot(field);if(!snap||snap.selected)return;
 // Only at the end of a word or line: mid-word, the word is the user's to finish.
 if(/^[\p{L}\p{N}]/u.test(snap.after))return;
 const words=snap.before.trim().split(/\s+/).filter(Boolean).length;if(words<bar.minWords&&snap.before.trim())return;
 if(live&&!live.final){post({type:'cancel',id:live.id});chained.delete(live.id);}
 if(showKept(field,snap.before))return;
 const key=keyOf(field),context=readContext(field);
 // What comes after a suggestion just taken is already on its way (asked ahead): it is this request's answer.
 const coming=[...chained].find(([,k])=>k===cacheKey(key,snap.before))?.[0];
 if(coming){live={id:coming,field,key,base:snap.before,text:'',alts:[],final:false,pausedAt:lastInput||performance.now(),context,taken:0,reported:false,from:'cache'};return;}
 const id=`t${++seq}`;
 live={id,field,key,base:snap.before,text:'',alts:[],final:false,pausedAt:lastInput||performance.now(),context,taken:0,reported:false,from:'model'};
 lastRequest=performance.now();forgetUnanswered(id);
 post({type:'tab',id,context,before:snap.before,after:snap.after,text:snap.text.slice(-4000)});
}
/** What comes after a suggestion that is whole, asked now and kept, so taking it shows the next part at once. Not after
 * a one-line field's line is done, nor after nothing. */
function chain(current:Live){
 if(!current.text||current.done)return;
 const before=current.base+current.text,key=cacheKey(current.key,before);if(cache.has(key)||[...chained.values()].includes(key))return;
 const snap=snapshot(current.field),id=`c${++seq}`;chained.set(id,key);if(chained.size>20)chained.delete(chained.keys().next().value!);
 post({type:'tab',id,context:current.context,before,after:snap?.after??'',text:before.slice(-4000),chain:true});forgetUnanswered(id);
}
/** An answer that has not come in eight seconds never will (stopped, failed, its line lost): nothing goes on waiting for
 * it, so the next words are asked as usual. */
function forgetUnanswered(id:string){
 setTimeout(()=>{chained.delete(id);if(live?.id===id&&!live.final){if(!live.text){live=null;hideGhost();}else live.final=true;}},8000);
}

function onAnswer(message:any){
 // Nothing asked before the line went down will come: no suggestion waits on it (the next keystroke asks again).
 if(message?.type==='port.lost'){chained.clear();if(live&&!live.final){live=null;hideGhost();}return;}
 if(message?.type==='tab.quick'){if(live&&'q'+live.id===message.id&&!live.text&&message.text){live.text=message.text;live.from='local';render();}return;}
 if(message?.type!=='tab.text')return;
 // A continuation asked ahead: kept for the moment its suggestion is taken.
 const ahead=chained.get(message.id);
 if(ahead&&message.final){chained.delete(message.id);if(message.text||message.done)cache.set(ahead,{text:message.text??'',alts:message.alternatives??[],source:message.source,used:message.used,done:!!message.done});}
 // Unless the suggestion it follows was taken while it was on its way (then it is what shows now).
 if(ahead&&live?.id!==message.id)return;
 if(message.final)lastAnswer=performance.now();
 if(!live||message.id!==live.id)return;
 // What shows only ever grows (or is cut back to a shorter end): a different suggestion never takes its place under the
 // user's eyes, so Tab takes exactly what they saw. A different final answer is kept as another way to go on.
 let other:string|undefined;
 if(message.text){
  if(!live.text||message.text.startsWith(live.text)||message.final&&live.text.startsWith(message.text)){live.text=message.text;if(live.from!=='cache')live.from='model';}
  else if(message.final)other=message.text;
 }
 if(message.final){
  live.final=true;live.alts=[...(other?[other]:[]),...(message.alternatives??[])].filter(a=>a!==live!.text).slice(0,3);live.source=message.source;live.used=message.used;live.confidence=message.confidence;
  // The model decides when the text is whole (∎): then nothing more is asked, and the next step is a move.
  live.done=!!message.done&&!other;
  if(live.text){cache.set(cacheKey(live.key,live.base),{text:live.text,alts:live.alts,source:live.source,used:live.used,done:live.done});if(cache.size>200)cache.delete(cache.keys().next().value!);chain(live);}
  if(live.shownAt)post({type:'tab.timing',ms:-1,split:message.split});
 }
 // Kept while they typed on, it came back empty or going another way than they went: let go (the pause asks again).
 if(message.final&&!fits(live)){if(performance.now()-lastInput>=PAUSE&&fieldIsFocused(live.field)){const field=live.field;live=null;hideGhost();void request(field);}else{live=null;hideGhost();}return;}
 // Nothing more to write, and the model says the text is finished: the next step is a move.
 if(!live.text){if(message.final){const field=live.field,done=live.done;hideGhost();live=null;if(done)textDone(field.el);}return;}
 render();
}
/** Draws what is left of the suggestion at the caret (and where a fact in it came from). */
function render(){
 if(!live||!live.text)return;
 // A move is on screen and they have not typed since it came: it stays what they see (and what Tab does); these words
 // wait for their next keystroke.
 const since=moveSince();if(since!==undefined&&lastInput<since)return;
 const field=live.field;if(!fieldIsFocused(field)){drop('ignored');return;}
 const snap=snapshot(field);if(!snap)return;
 const rest=remainder(live.base,live.text,snap.before);if(!rest){hideGhost();return;}
 layer();const caret=caretOf(field);
 if(!caret){post({type:'failure',site:location.hostname,editor:field.editor,what:'placement',detail:'no caret position'});return;}
 const drawing=performance.now();
 // A search box is one line however the page built it (a textarea, an editable div): its ghost too.
 const oneLine=field.singleLine||live.context.intent==='search';
 showGhost(caret,oneLine?rest.split('\n')[0]:rest,{atLineEnd:!snap.after||snap.after.startsWith('\n'),singleLine:oneLine,ownWrapping:field.kind==='context'});
 wordsShown(true,live.confidence);
 // Which of the ways to go on this is (once they go through them), and where a fact in it came from.
 const from=live.source?`from ${live.source.title} · ${live.source.when}`:'';
 if(from)showHint(caret,from);
 if(!live.shownAt){live.shownAt=performance.now();post({type:'tab.timing',ms:live.shownAt-live.pausedAt,from:live.from,render:Math.round(live.shownAt-drawing)});}
}

function onKey(event:KeyboardEvent){
 if(!alive())return;
 if(!live||!live.text||!ghostShown()||event.isComposing)return;
 const field=live.field,snap=snapshot(field),rest=snap?remainder(live.base,live.text,snap.before):null;if(!rest)return;
 // Alt and + (Alt and − back): another way to go on (the alternatives that still fit what is typed), in place of this one.
 const dir=cycles(event);
 if(dir){
  const options=[...new Set(live.options??[live.text,...live.alts])].filter(o=>remainder(live!.base,o,snap!.before));
  if(options.length>1){took(event);const at=(Math.max(0,options.indexOf(live.text))+dir+options.length)%options.length;live.options=options;live.text=options[at];live.alts=options.filter((_,i)=>i!==at);render();}
  return;
 }
 if(takes(event)&&mayTake('text')){
  took(event);void accept(field,rest,true);
 }else if(event.key==='ArrowRight'&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!editorOwnsTab(field)){
  event.preventDefault();event.stopImmediatePropagation();
  const word=/^\s*[^\s]+/.exec(rest)?.[0]??rest;void accept(field,word,word.length>=rest.length);
 }else if(event.key==='Escape'){
  event.preventDefault();event.stopImmediatePropagation();drop('dismissed');
 }
}
async function accept(field:Field,text:string,all:boolean){
 hideGhost();const current=live!;
 // Never waits more than two seconds: an editor that never shows the words back (or a tab hidden mid-insert, where frames
 // stop) must not leave Tab deaf to the user's typing.
 accepting=true;const result=await Promise.race([insert(field,text),new Promise<Inserted>(r=>setTimeout(()=>r({ok:false,reason:'timeout'}),2000))]).finally(()=>{accepting=false;});
 if(!result.ok){
  post({type:'failure',site:location.hostname,editor:field.editor,what:'insert',detail:result.reason??'not inserted'});
  try{await navigator.clipboard.writeText(text);}catch{}
  drop('ignored');return;
 }
 current.taken+=text.length;
 if(all){
  drop(current.taken>=current.text.length?'accepted':'partial',current.taken);
  // What they took finishes the text: no more words, the next step (Send, Post, Next) shows.
  if(current.done&&current.taken>=current.text.length){textDone(field.el);return;}
  // What comes next was asked ahead: it shows at once; otherwise it is asked now.
  lastInput=performance.now();clearTimeout(timer);const snap=snapshot(field);
  if(!(snap&&showKept(field,snap.before)))timer=window.setTimeout(()=>void request(field),0);
 }
 else if(live===current)render();
}
function onSelection(){
 if(!live||!live.text||accepting)return;
 const snap=snapshot(live.field);
 // The caret right after the whole suggestion: it was taken (the browser says so before accept() is done counting).
 if(snap&&!snap.selected&&snap.before===live.base+live.text)return;
 // The caret went somewhere the suggestion does not continue from.
 if(!snap||snap.selected||!remainder(live.base,live.text,snap.before)&&!live.alts.some(a=>remainder(live!.base,a,snap.before)))drop('ignored');
}
/** Ends the current suggestion, reporting once what became of it. */
function drop(outcome:'accepted'|'partial'|'ignored'|'dismissed',taken=0){
 const current=live;live=null;hideGhost();clearTimeout(timer);
 // A prediction still streaming is no longer wanted: stop the model (and nothing waits on it any more).
 if(current&&!current.final){post({type:'cancel',id:current.id});chained.delete(current.id);}
 if(!current||current.reported||!current.shownAt)return;current.reported=true;
 post({type:'tab.outcome',site:location.hostname.replace(/^www\./,''),intent:current.context.intent,kind:'text',text:current.text,accepted:taken||current.taken,outcome:current.taken&&outcome==='ignored'?'partial':outcome,latencyMs:current.shownAt-current.pausedAt,used:current.used});
}
function clear(){if(live)drop('ignored');clearTimeout(timer);hideGhost();}
/** What Tab is showing now (for the engine's checks and the tests). */
export function tabState(){
 if(!live)return{showing:false};
 const snap=snapshot(live.field),rest=snap?remainder(live.base,live.text,snap.before):null;
 return{showing:ghostShown()&&!!rest,rest,text:live.text,final:live.final,from:live.from,alternatives:live.alts,source:live.source};
}
