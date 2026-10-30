/// <reference types="chrome" />
import {takes,took,cycles,offers,mayTake,TAKE_KEY} from './keys';
import {onTextDone,moveShown,moveBeatsWords,yieldWords,offerWords} from './bus';
import {roleOf,nameOf,deepActive,visible,squash} from './dom';
import {describe,pageModel,deepQuery,hoverOwner,elementById,type Item} from './perceive';
import {fieldOf,inPaymentFrame,unseenFrame} from './fields/field';
import {snapshot} from './fields/text';
import {readContext} from './context';
import {perform,irreversible,findTarget,type Action,type Target,type Done} from './act';
import {pageText} from './capture';
import {digestOf,noteAppeared,type Digest} from './digest';
import {surface,layer,raise} from './ui/root';
import {ghostShown,ghostAt,onGhostShown} from './ui/ghost';
import {caretOf} from './fields/caret';
import {startGlow,clearLikely,takeNow,likelyMoves,pointerAt,pointerMoving,glowState} from './glow';
import {post,listen as portListen,ask as request,alive} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {stepKey,type Plan,type PlanStep} from '../shared/plan';
/** Tab for actions, on any page: the user's next move, as a code editor's Tab is the next edit. As they work, Gumbo
 * guesses the one thing they are about to do (click this, fill in these fields, choose that, drag this card there, open
 * that menu, go back) and shows it in one small line by the cursor, the thing it would touch lightly outlined. Tab does
 * it; the move after it is already known and shows the moment this one is done, so Tab, Tab, Tab goes as fast as they
 * do, one visible move at a time (longer jobs are the agent's). A move that sends, buys or deletes waits for Enter; Esc
 * dismisses. It steps aside while a text suggestion shows, while the user is mid-word, and where Gumbo is off. What the
 * user does by hand (clicks, choices, typing, drags, double- and right-clicks) is the context of the next guess, and each
 * click is reported (its role and name, never what was typed) so habits are learned.
 * It asks the moment the page has settled after what the user did, not after a fixed wait, and the older question is
 * cancelled; a field the pointer rests on is asked about before the click. */
let pressed:{el:Element;at:number}|undefined,preview:HTMLDivElement|null=null,settings:Settings|undefined,hint:{plan:Plan;el?:Element;final:boolean;source?:string}|null=null,chip:HTMLDivElement|null=null,rings:HTMLDivElement[]=[];
let timer:number|undefined,wave=0,seq=0,asking:string|undefined,lastKey=0,running=false,taking=false,waitEnter:((yes:boolean)=>void)|null=null,finalArrived:(()=>void)|null=null;
/** The elements the current guess was made from, so a step finds its element again if the page re-rendered it. */
let seen=new Map<string,Item>();
const activity:{kind:string;label:string;text?:string}[]=[];
// A frame nobody sees (a drawn editor's typing box) has nothing to guess from: the page around it guesses.
const active=()=>!!settings&&activeOn(settings,location.hostname)&&!inPaymentFrame()&&!unseenFrame();
const actionable='a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],summary,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],label';
const dialogs='[role=dialog],[role=alertdialog],dialog,[aria-modal=true]';
/** A step the user took here: the context of the next guess, and memory's (memory/live.ts keeps the tab's trail across
 * pages, the event log keeps it for good, chained). what: the element it touched (its role, name and place, never what was
 * typed), and value, an option chosen or a box's state. Typing on in one field is sent at most every 1.5 s. */
const did=(kind:string,label:string,text?:string,what?:{role:string;name:string;path?:string;nearby?:string},value?:string)=>{
 const prev=activity.at(-1);if(prev&&prev.kind===kind&&prev.label===label)activity.pop();activity.push({kind,label:label.slice(0,80),text:text?.slice(-200)});if(activity.length>10)activity.shift();
 if(kind==='typed'&&prev?.kind==='typed'&&prev.label===label.slice(0,80)&&Date.now()-lastLogged<1500)return;
 lastLogged=Date.now();post({type:'event',kind,label:label.slice(0,80),text:text?.slice(-200),title:document.title,...what,value});
};
let lastLogged=0;
/** What a hand touched, in a few words: the card, row, item or control it belongs to. */
const what=(el?:Element|null)=>{if(!el)return 'something';const at=el.closest(`[draggable=true],[role=listitem],[role=row],li,tr,${actionable}`)??el;return nameOf(at,40)||squash((at as HTMLElement).innerText??'').slice(0,40)||roleOf(at);};

/** Every frame has Tab: a lesson, a quiz or an editor embedded from another site is guessed about on its own. A frame
 * guesses only once the user has worked in it (pressed, focused, typed: ads and widgets never ask), and its move hides
 * when the user goes elsewhere, so one move shows at a time. */
const inFrame=window!==window.top;let touched=!inFrame,opened=false;
/** The page's first moment, once it is in view: what to do here, and, asked ahead, the first empty field in view. */
function opening(){
 if(opened||inFrame||!settings||document.visibilityState!=='visible')return;
 opened=true;const first=emptyFieldsAfter()[0];if(first)aheadInto(first);page(150);
}
/** A page moment: the page opened, a click that did not start something here, a scroll that stopped on new things, a
 * return to the tab. Tab offers a move here only when one is obvious and in view (getting somewhere is the agent's). */
function page(ms:number){working=null;soon(ms);}
/** Where the user is working (the element of their last task moment): Tab's move is chosen from what is around it, never
 * from the whole page, as Cursor's Tab continues the code being written rather than guessing at another file. */
let working:Element|null=null;
/** A task moment: the user did part of something here (typed, chose, ticked, pasted, opened a menu or a dialog, dropped
 * something). Tab looks at what is around it and offers the next part, the first moment it is sure. A page opening, a
 * scroll, a link followed or the page changing by itself are not task moments. */
function task(at:Element|null,ms:number,quick=false){working=at;soon(ms,quick);}
const holders='dialog,[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=menubar],[role=toolbar],[role=tablist],[role=radiogroup],[role=search],[role=form],form,fieldset';
const controls='a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=combobox],[role=textbox],[contenteditable=true]';
/** What is around a task moment: what a toggle just opened (its menu, list or dialog); else the dialog, menu, form, search
 * box or toolbar it is in; else the smallest box around it holding a few controls (a message box and its Send). */
function scopeOf(at:Element):Element{
 if(at.getAttribute('aria-expanded')==='true'||at.hasAttribute('aria-haspopup')){
  const id=at.getAttribute('aria-controls'),owned=id?document.getElementById(id):null;if(owned&&visible(owned))return owned;
  const popup=deepQuery('[role=menu],[role=listbox],[role=dialog],dialog[open]').filter(visible).at(-1);if(popup&&!popup.contains(at))return popup;
 }
 const box=at.closest(holders);if(box&&box!==document.body&&box.querySelectorAll(controls).length<=60)return box;
 let n=at.parentElement,last:Element=at;
 for(let i=0;i<8&&n&&n!==document.body;i++,n=n.parentElement){const count=n.querySelectorAll(controls).length;if(count>60)break;last=n;if(count>=3)return n;}
 return last;
}
/** Where they are, in words, for the model: what kind of place it is and its own text. */
function whereOf(scope:Element){
 const kind=scope.getAttribute('role')??scope.tagName.toLowerCase(),name=nameOf(scope,60);
 return{kind:`${kind}${name?` “${name}”`:''}`,text:squash((scope as HTMLElement).innerText??'').slice(0,1500)};
}
export function startPredict(){
 // As the page opens: what to do here, and, asked ahead, the first empty field in view (where a form starts).
 // The field first: a click into it in the page's first second finds its guess on the way already.
 void loadSettings().then(s=>{settings=s;opening();});onSettings(s=>{settings=s;if(!active())hide();});
 // A page opened behind another tab has its first moment when it comes into view; coming back to a tab is a moment too
 // (what they did in the tab they left is part of it).
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'||inFrame)return;if(!opened)opening();else if(!running){page(100);returned=true;}});
 startGlow();void undoArrival();
 // A text suggestion showing comes first: a move's chip steps aside (it is kept, and comes back at the next beat).
 onGhostShown(()=>{if(hint&&!running&&!waitEnter&&!taking){const f=fieldOf(deepActive());if(f)typedAhead={el:f.el,plan:hint.plan,at:Date.now()};hide();}});
 // A scroll that stopped on new things (half a screen or more since the last guess): what they came to see is in view.
 let scrolled:number|undefined,guessedAtY=scrollY;
 window.addEventListener('scroll',()=>{clearTimeout(scrolled);scrolled=window.setTimeout(()=>{if(!running&&!inFrame&&Math.abs(scrollY-guessedAtY)>innerHeight*0.5){guessedAtY=scrollY;page(0);}},450);},{passive:true});
 if(inFrame)for(const type of ['pointerdown','keydown','focusin'])document.addEventListener(type,e=>{if(e.isTrusted)touched=true;},true);
 window.addEventListener('blur',()=>{if(!running&&!waitEnter&&!taking)hide();});
 did('opened',document.title);
 document.addEventListener('click',onClick,true);
 document.addEventListener('pointerover',onRest,true);
 // A press on a field starts the guess at once (the focus and the click follow a moment later and are not waited for again).
 document.addEventListener('pointerdown',e=>{const t=e.composedPath()[0] as Element|undefined,f=t instanceof Element?fieldOf(t):null;if(f&&e.isTrusted){pressed={el:f.el,at:Date.now()};task(f.el,0,true);}},true);
 document.addEventListener('focusin',()=>{
  const f=fieldOf(deepActive());if(hint)drawPreviews();if(!f)return;
  did('focused',nameOf(f.el,60)||'a field');if(!(pressed&&pressed.el===f.el&&Date.now()-pressed.at<500))task(f.el,120,true);
  // The next field in the form is where they go after this one: asked ahead, once this one's guess is on its way.
  setTimeout(()=>{const next=emptyFieldsAfter(f.el)[0];if(next)aheadInto(next);},700);
 },true);
 // The faint text belongs to the field the cursor is in: it goes when the cursor leaves.
 document.addEventListener('focusout',()=>{if(previews.length)setTimeout(()=>{if(hint)drawPreviews();},0);},true);
 document.addEventListener('change',e=>{const t=e.target;if(t instanceof HTMLSelectElement){did('chose',nameOf(t,60),t.selectedOptions[0]?.text,{role:'combobox',name:nameOf(t,60)},t.selectedOptions[0]?.text);task(t,150);}else if(t instanceof HTMLInputElement&&/checkbox|radio/.test(t.type)){did(t.checked?'checked':'unchecked',nameOf(t,60),undefined,{role:t.type,name:nameOf(t,60)},t.checked?'on':'off');task(t,150);}else if(t instanceof HTMLInputElement&&t.type==='range'){did('set',nameOf(t,60),t.value,{role:'slider',name:nameOf(t,60)},t.value);task(t,150);}},true);
 document.addEventListener('paste',e=>{const f=fieldOf(deepActive());if(f&&e.isTrusted&&!running){did('pasted into',nameOf(f.el,60)||'a field',e.clipboardData?.getData('text/plain')?.slice(0,200));task(f.el,250,true);}},true);
 // Typing: nothing is asked per keystroke. The next step is asked once, quietly, as typing starts in a field (and again
 // when what the page shows changes), and shows at a moment the entry looks complete: a beat with no typing (a quarter
 // of a second), Enter, leaving the field, the page answering, or a value complete by its shape (an email, a number, a
 // date, a finished sentence). Never mid-word. Only the user's own typing in a text field is typing: a slider moved, a
 // box checked, or what Tab itself typed is not.
 document.addEventListener('input',e=>{
  if(running)return;
  const f=fieldOf(deepActive()),t=e.composedPath()[0];
  if(!f||!(t instanceof Node)||!(f.el===t||f.el.contains(t)))return;
  lastKey=Date.now();hide();
  const s=snapshot(f);
  did('typed',nameOf(f.el,60)||'a field',s?.before);
  if(typingIn!==f.el){typingIn=f.el;aheadOfPause();}
  // Writing (a message, a post, a document): a move may still come at a pause, wherever the model is sure of one (attach
  // the file, tag the person, pick the label); only the step that sends what they write waits for the text model to say
  // the text is done (heldForText, onTextDone below). A sentence ending is not the end of a message.
  finished.delete(f.el);
  // While writing, a move is asked at a real pause (0.7 s), not between words: every quarter second sent a burst of
  // guesses that cancelled each other and slowed the text suggestions.
  if(writing(f)){task(f.el,700,true);return;}
  // A value complete by its shape needs no beat: the keyboard is no longer mid-word.
  if(looksComplete(f.el,s?.text??'')){lastKey=0;task(f.el,0,true);}else task(f.el,BEAT,true);
 },true);
 // The text is done (tab.ts): what was written is whole, so the next step is a move (Send, Post, Next), shown now.
 onTextDone(el=>{
  if(running||!active())return;finished.add(el);lastKey=0;typingIn=undefined;
  // A move's words taken from the ghost: the part of the task after them (the Check, the Send) shows, as after any move.
  const after=wordsThen;wordsThen=undefined;
  if(after&&after.el===el&&Date.now()-after.at<60_000&&after.plan.then){const next=after.plan.then,target=touches(next)?findTarget(targetOf(next)):null;if(!touches(next)||target){show({label:labelOn(next,target),confidence:after.plan.confidence,steps:[next]},true,'then');return;}}
  const ready=aheadForPause();if(ready&&!hint)show(ready,true,'ahead');task(el,0,true);
 });
 // Enter in a field, or leaving one with something in it: the entry is done.
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.isTrusted&&!waitEnter){const f=fieldOf(deepActive());if(f){lastKey=0;task(f.el,60,true);}}},true);
 document.addEventListener('focusout',e=>{const f=fieldOf(e.target as Element);if(f&&e.isTrusted&&!running&&(snapshot(f)?.text.trim()??'')){typingIn=undefined;lastKey=0;task(f.el,80,true);}},true);
 watchFeedback();
 watchHands();
 for(const type of ['pointerdown','keydown'])window.addEventListener(type,e=>{if(e.isTrusted)lastInput=Date.now();},true);
 window.addEventListener('keydown',onKey,true);
 offers('move',()=>!!waitEnter||!!chip&&!!hint&&!running&&!ghostShown());
 window.addEventListener('scroll',()=>requestAnimationFrame(place),{capture:true,passive:true});
 window.addEventListener('resize',()=>requestAnimationFrame(place));
 // A new route in an app that never reloads, and a dialog opening, are new moments to guess at.
 let href=location.href;
 setInterval(()=>{if(location.href!==href){href=location.href;did('went to',document.title||location.pathname);if(!running){hide();clearLikely();page(150);}}},250);
 // A dialog the user just opened (a click a moment ago) is a task moment, in that dialog; one the page opens by itself
 // is not.
 new MutationObserver(records=>{
  if(Date.now()-lastInput>1500)return;
  for(const r of records)for(const n of r.addedNodes)if(n instanceof Element&&(n.matches(dialogs)||n.parentElement===document.body&&n.querySelector(dialogs))){const d=n.matches(dialogs)?n:n.querySelector(dialogs)!;did('opened a dialog',nameOf(d,60)||'a dialog');task(d,60);return;}
 }).observe(document.body??document.documentElement,{childList:true,subtree:true});
}
/** The beat after the last keystroke at which an entry counts as finished for now (shared/memory-config.ts action.beatMs). */
const BEAT=250;
let typingIn:Element|undefined;
/** A value whose shape says it is whole: an email, a number, a date, a time, a finished sentence. */
function looksComplete(el:Element,text:string){
 const v=text.trim();if(!v)return false;
 const type=el instanceof HTMLInputElement?el.type:'';
 return type==='email'&&/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)||/^-?\d+([.,]\d+)?$/.test(v)&&type==='number'||/^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^\d{1,2}:\d{2}( ?[ap]m)?$/i.test(v)||/[.!?…]["”')]?$/.test(v);
}
/** The page answering what the user just did: text that appears in an alert, status or live region, a banner or toast,
 * a dialog, or near where they are working (a quiz's "Correct!", a form's "Email is taken"), a moment after they acted.
 * It is a moment: what to do next often depends on what the page said. */
function watchFeedback(){
 let last=0;
 new MutationObserver(records=>{
  if(Date.now()-lastInput>10_000||running||Date.now()-last<300)return;
  const scope=working?.isConnected?scopeOf(working):null,below=working?.isConnected?working.getBoundingClientRect():null;
  let n=0;
  for(const r of records){
   const nodes=r.type==='characterData'?[r.target]:[...r.addedNodes];
   for(const node of nodes){
    if(++n>30)return;
    const el=node instanceof Element?node:node.parentElement;if(!el||el.closest('gumbo-layer')||fieldOf(el))continue;
    const text=squash((node instanceof Element?(node as HTMLElement).innerText:node.textContent)??'');if(text.length<2||text.length>600)continue;
    const announced=!!el.closest('[role=alert],[role=status],[aria-live]:not([aria-live=off]),[role=dialog],dialog');
    const r2=el.getBoundingClientRect(),near=!!scope?.contains(el)||!!below&&r2.top>=below.top-40&&r2.top<below.bottom+320&&Math.abs(r2.left-below.left)<600;
    if(!announced&&!near||!visible(el))continue;
    last=Date.now();noteAppeared(text);did('the page said',text.slice(0,120));
    // Asked again quietly while they type; shown at once when they are not typing.
    if(typing())aheadOfPause();else task(working??el,60,true);
    return;
   }
  }
 }).observe(document.body??document.documentElement,{childList:true,subtree:true,characterData:true});
}
/** The moves a hand makes that are not clicks: a drag (the browser's own drag and drop, or a press, a move and a release
 * somewhere else that did not select text), a double-click, a right-click. They are what the next move often repeats. */
function watchHands(){
 let dragged:Element|undefined,down:{el:Element;x:number;y:number;at:number}|undefined;
 document.addEventListener('dragstart',e=>{if(e.isTrusted)dragged=e.composedPath()[0] as Element;},true);
 document.addEventListener('drop',e=>{if(!e.isTrusted)return;const onto=e.composedPath()[0] as Element;did('dragged',`${what(dragged)} onto ${what(onto)}`);dragged=undefined;down=undefined;task(onto,150);},true);
 document.addEventListener('pointerdown',e=>{if(e.isTrusted&&e.button===0)down={el:e.composedPath()[0] as Element,x:e.clientX,y:e.clientY,at:Date.now()};},true);
 document.addEventListener('pointerup',e=>{
  const d=down;down=undefined;if(!e.isTrusted||!d||dragged)return;
  const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)<30||Date.now()-d.at>8000||getSelection()?.toString().trim())return;
  const onto=document.elementFromPoint(e.clientX,e.clientY);
  did('dragged',`${what(d.el)}${onto&&!d.el.contains(onto)?` onto ${what(onto)}`:''} (by ${Math.round(dx)}, ${Math.round(dy)} px)`);task(d.el instanceof HTMLCanvasElement?null:d.el,150);
 },true);
 document.addEventListener('dblclick',e=>{if(e.isTrusted){const t=e.composedPath()[0] as Element;did('double-clicked',what(t));task(t instanceof HTMLCanvasElement?null:t,150);}},true);
 document.addEventListener('contextmenu',e=>{if(e.isTrusted){const t=e.composedPath()[0] as Element;did('right-clicked',what(t));task(t instanceof HTMLCanvasElement?null:t,120);}},true);
}
function onClick(event:MouseEvent){
 if(!alive())return;
 if(!event.isTrusted||(chip&&event.composedPath().includes(chip)))return;
 const target=(event.composedPath()[0] as Element|undefined)?.closest?.(actionable);
 if(active()&&target&&!fieldOf(target)){const item=describe(target);if(item.name)did('clicked',item.name,undefined,{role:roleOf(target),name:item.name,path:item.path,nearby:item.nearby});}
 // A click on a drawing has no element to name: where it was (in the view's pixels) is what the next guess knows.
 else if(event.composedPath()[0] instanceof HTMLCanvasElement)did('clicked on the drawing',`at ${Math.round(event.clientX)}, ${Math.round(event.clientY)}`);
 // The click that ends a press on a field: its guess is already on the way (or showing).
 const f=target?null:fieldOf(event.composedPath()[0] as Element),same=!!(f&&pressed&&pressed.el===f.el&&Date.now()-pressed.at<800);
 if(same)return;
 if(!running){hide();clearLikely();}
 // A click that starts or changes something here (opened a menu, chose a tab or an option, ticked a box) is a task
 // moment, there; any other click is a page moment: where they go next on the page (a link that leaves the page is
 // followed by the next page's own moment).
 const path=event.composedPath()[0] as Element|undefined;
 const toggle=path?.closest?.('[aria-haspopup],[aria-expanded],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],summary,label,input[type=checkbox],input[type=radio]');
 if(toggle)task(toggle,80);else if(path instanceof HTMLCanvasElement)task(null,150);else page(100);
}
/** Asks once the page has settled: a moment after what the user did, then until nothing has been added, removed, opened
 * or closed for a beat (a menu opening, a route loading), a second and a half at most. quick: what the user did changes
 * little on the page (the cursor went into a field, they paused typing), so it waits only a beat for the page, however
 * busy the page itself keeps being. */
function soon(ms:number,quick=false){
 if(!touched)return;
 // A newer moment (the user did something) is not the return to the tab.
 clearTimeout(timer);const mine=++wave;returned=false;
 timer=window.setTimeout(()=>void (quick?settled(40,150):settled(80,350)).then(()=>{if(mine===wave)void guess();}),ms);
}
function settled(quiet=120,max=1500):Promise<void>{
 return new Promise(resolve=>{
  let t=setTimeout(done,quiet);const cap=setTimeout(done,max);
  const watch=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(done,quiet);});
  watch.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-expanded','aria-hidden','open','hidden','disabled']});
  function done(){clearTimeout(t);clearTimeout(cap);watch.disconnect();resolve();}
 });
}
/** Mid-word, or a text suggestion showing: the keyboard is the user's (a text suggestion always comes before a move). */
const typing=()=>Date.now()-lastKey<BEAT||ghostShown();

let lastMoment='',lastMomentAt=0;
/** The next guess is for coming back to this tab: asked before the user does anything here (ahead, for thrift.ts). */
let returned=false;
/** Asks the engine: the page's words, the elements where they are working (or the page's, at a page moment), and the
 * whole page in brief (digest.ts), so a move can be anything on the page and never only what is near the cursor. */
function ask(id:string,model:ReturnType<typeof pageModel>,moments:typeof activity,focused?:string,back=false,where?:{kind:string;text:string},region?:Element|null){
 const digest=inFrame&&!region?undefined:digestOf(region,new Set(model.items.map(i=>i.id)));
 for(const r of digest?.rest??[])if(!seen.has(r.id))seen.set(r.id,{...r,rect:[0,0,0,0],path:''});
 send(id,model,moments,focused,back,where,digest);
}
const send=(id:string,model:ReturnType<typeof pageModel>,moments:typeof activity,focused:string|undefined,back:boolean,where:{kind:string;text:string}|undefined,digest:Digest|undefined)=>post({type:'predict',id,title:document.title,text:pageText(1500),...(where?{where}:{}),...(digest?{digest}:{}),items:model.items.map(i=>({id:i.id,role:i.role,name:i.name,value:i.value,state:i.state,inView:i.inView,nearby:i.nearby,near:nearPointer(i.rect)})),activity:moments,focused,ahead:back||id.startsWith('a'),
 // A clue: the user's own hand on this page a moment ago (only then may a move show; see the engine).
 clue:Date.now()-lastInput<20_000,
 // A page drawn as pixels: the engine looks at a picture of the view, and moves may point at spots in it.
 ...(!inFrame&&drawnSurface()?{drawn:true,view:[innerWidth,innerHeight]}:{})});
/** Whether an element is within reach of their pointer (where they are looking and heading). */
function nearPointer(rect:[number,number,number,number]){
 const p=pointerAt();if(!p||!pointerMoving())return undefined;
 const dx=Math.max(rect[0]-p[0],0,p[0]-(rect[0]+rect[2])),dy=Math.max(rect[1]-p[1],0,p[1]-(rect[1]+rect[3]));
 return Math.hypot(dx,dy)<220||undefined;
}
/** When the user last clicked, pressed a key or touched this page (their own input, never the page's). */
let lastInput=0;
/** Whether the page is mostly drawn as pixels (a document, a sheet, a design, a board, a map): canvases cover a good part
 * of the view, so its words and shapes are not elements anyone can read. */
export function drawnSurface(){
 let covered=0;
 for(const c of deepQuery('canvas',document,4000)){
  if(!visible(c))continue;const r=c.getBoundingClientRect();
  covered+=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));
 }
 return covered>innerWidth*innerHeight*0.2;
}
async function guess(){
 if(!active()||running||taking||typing()||document.visibilityState!=='visible')return;
 // A move asked ahead while they typed shows the moment they stop; this guess, with every word, follows it.
 const ready=aheadForPause();if(ready&&!hint)show(ready,false,'ahead');
 // The same moment as the last guess (nothing done since, the same address and cursor): not asked again. A page that keeps
 // changing by itself (a chat streaming, a feed, popups coming and going) would otherwise ask every second or two, and
 // the move would flip while the user looks at it (seen in the logs: the same page asked about 40 times in a minute).
 // A task moment looks at where they are working; a page moment at the page, by what is in view.
 const scope=working&&working.isConnected&&!drawnSurface()?scopeOf(working):null;
 const focused=fieldOf(deepActive()),moment=`${location.href}|${activity.length}|${JSON.stringify(activity.slice(-2))}|${focused?nameOf(focused.el,60):''}|${scope?'task':`page ${Math.round(scrollY/(innerHeight*0.5))}`}`;
 // The same moment: the move it had is shown again if a click or a key put it away without turning it down.
 if(moment===lastMoment&&Date.now()-lastMomentAt<60_000){reshowLast();return;}
 lastMoment=moment;lastMomentAt=Date.now();
 if(asking)post({type:'cancel',id:asking});
 const id=`p${++seq}`,model=scope?pageModel(50,scope):pageModel(120),focus=focused;
 asking=id;mode=scope?'task':'page';for(const i of model.items)seen.set(i.id,i);
 listen(id);
 const back=returned;returned=false;
 ask(id,model,activity,focus?nameOf(focus.el,60)||'a field':undefined,back,scope?whereOf(scope):undefined,scope);
}
/** What the guess on its way is for: continuing a task where they are working, or where they go next on the page. */
let mode:'task'|'page'='task';
/** Asked ahead: the pointer resting on a field is the moment before the user clicks into it, so the guess for "the
 * cursor is in that field" is asked then, exactly as it will be asked after the click; the engine keeps its answer, and
 * the click finds it ready. Nothing shows from this by itself. */
let restTimer:number|undefined,typedTimer:number|undefined,ahead=0;const askedAhead=new WeakMap<Element,number>();
function onRest(event:PointerEvent){
 clearTimeout(restTimer);
 const t=event.composedPath()[0],f=t instanceof Element?fieldOf(t):null;
 if(!f||!event.isTrusted||event.pointerType==='touch')return;
 // Resting on a field is working in it (a frame's quiz box is asked about before its first click).
 restTimer=window.setTimeout(()=>{touched=true;aheadInto(f.el);},90);
}
/** Asked ahead for the field the user is about to go into (the pointer rests on it, it is the first empty one when the
 * page opens, it is the next one in the form they are filling): the guess "the cursor is in that field" is asked as the
 * focus will ask it, and the click (or Tab key) finds it ready. */
function aheadInto(el:Element){
 if(!active()||running||taking||typing()||!touched||document.visibilityState!=='visible'||el===fieldOf(deepActive())?.el||Date.now()-(askedAhead.get(el)??0)<30_000)return;
 askedAhead.set(el,Date.now());
 const name=nameOf(el,60)||'a field',last=activity.at(-1);
 // The moments as they will be once the focus is there (did() keeps one entry for a repeat).
 const moments=last?.kind==='focused'&&last.label===name.slice(0,80)?activity:[...activity,{kind:'focused',label:name.slice(0,80)}].slice(-10);
 const scope=scopeOf(el),model=pageModel(50,scope);for(const i of model.items)seen.set(i.id,i);
 ask(`a${++ahead}`,model,moments,name,false,whereOf(scope),scope);
}
/** Asked ahead for the moment typing stops (a sentence ended, a pause began): the same question the pause will ask, so
 * the send, the search or the next field is ready when they look up. */
function aheadOfPause(){
 const f=fieldOf(deepActive());
 if(!f||!active()||running||taking||ghostShown()||document.visibilityState!=='visible')return;
 lastAhead=Date.now();
 const scope=scopeOf(f.el),id=`a${++ahead}`,model=pageModel(50,scope);for(const i of model.items)seen.set(i.id,i);
 // Its answer is kept: when they stop, a move that does not hang on the exact words (the send, the search, the next
 // field) shows at once, while the guess for the final words is made.
 const stop=portListen(m=>{if(m?.type!=='predict.plan'||m.id!==id||!m.final)return;stop();if(m.plan)typedAhead={el:f.el,plan:m.plan,at:Date.now()};
  // Asked while they typed and answered after they stopped: it shows now, as the beat's own guess would.
  if(m.plan&&!typing()&&!hint&&!running&&fieldOf(deepActive())?.el===f.el){const ready=aheadForPause();if(ready)show(ready,true,'ahead');}});
 setTimeout(stop,8000);
 ask(id,model,activity,nameOf(f.el,60)||'a field',false,whereOf(scope),scope);
}
let typedAhead:{el:Element;plan:Plan;at:number}|undefined,lastAhead=0;
/** The move asked ahead while they typed, if it still holds now that they stopped: for this field, a few seconds old,
 * and typing nothing into it (what they wrote since would change that). */
function aheadForPause():Plan|undefined{
 const a=typedAhead,f=fieldOf(deepActive());
 if(!a||!f||a.el!==f.el||Date.now()-a.at>15_000)return;
 const intoHere=a.plan.steps.some(s=>s.do==='type'&&s.id&&(()=>{const el=findTarget(targetOf(s));return !!el&&(el===f.el||f.el.contains(el));})());
 return intoHere?undefined:a.plan;
}
const empty=(el:Element)=>el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?!el.value:!(el.textContent??'').trim();
/** The empty fields in view, in the order a person fills them. */
function emptyFieldsAfter(from?:Element):Element[]{
 const all=deepQuery('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]),textarea,[contenteditable=true],[role=textbox]',document,3000)
  .filter(el=>visible(el)&&!!fieldOf(el)&&empty(el)&&(()=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;})());
 if(!from)return all;
 const i=all.findIndex(el=>el===from||el.contains(from)||from.contains(el));
 return i<0?all.filter(el=>from.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING):all.slice(i+1);
}
let stopListening:(()=>void)|undefined;
function listen(id:string){
 stopListening?.();
 // The instant guess (a habit, the user's own details) may come first, then the move as it streams; the whole reply
 // replaces them.
 stopListening=portListen(m=>{
  if(m?.type!=='predict.plan'||m.id!==id||Number(id.slice(1))!==seq)return;
  if(m.final){asking=undefined;finalArrived?.();}
  if(running)return;
  // A move much surer than the words showing takes their place once the keyboard rests (bus.ts): the order number the
  // support chat asked for over a guess at a sentence.
  // Its being much surer also says the text is done: the Send it held for the words is no longer held.
  if(m.final&&m.plan?.steps.length&&ghostShown()&&Date.now()-lastKey>=BEAT&&moveBeatsWords(m.plan.confidence)){const f=fieldOf(deepActive());if(f)finished.add(f.el);yieldWords();}
  // An answer that lands while they type (or while a text suggestion shows) is kept, and shown at the next beat.
  if(typing()){const f=fieldOf(deepActive());if(m.final&&m.plan&&f)typedAhead={el:f.el,plan:m.plan,at:Date.now()};return;}
  // The engine sends only a move it is sure of, on something in view: it is said plainly, its chip by the thing it would
  // press, outlined, ready for Alt+Q, as soon as its first step has streamed in.
  // The send for a message not finished yet is kept for the moment it is (onTextDone shows it).
  if(m.plan?.steps.length&&heldForText(m.plan)){const f=fieldOf(deepActive());if(m.final&&f)typedAhead={el:f.el,plan:m.plan,at:Date.now()};return;}
  if(m.plan?.steps.length)show(m.plan,!!m.final,mode==='page'?'page':m.source);else if(m.final&&hint&&!hint.final&&!taking)hide();
  // A new guess that found nothing does not take away the move they just saw.
  if(m.final&&!m.plan?.steps.length)reshowLast();
 });
}

/** A field someone writes a message in (an email, a chat, an AI's prompt box, a comment, a post, a document), one line or
 * many: its send waits for the text to be done. A search box or a form's field is not. */
const intents=new WeakMap<Element,string>();
const writing=(f:NonNullable<ReturnType<typeof fieldOf>>)=>{if(!f.singleLine)return true;let i=intents.get(f.el);if(!i){i=readContext(f).intent;intents.set(f.el,i);}return ['email','chat','prompt','comment','post','document'].includes(i);};
/** A move shown as words in the field (bus.ts offerWords), whose next part comes once they are taken. */
let wordsThen:{el:Element;plan:Plan;at:number}|undefined;
/** The writing fields whose text the text model said is done (bus.ts), until they type in them again. */
const finished=new WeakSet<Element>();
/** A step that sends what is being written (Send, Post, Reply, Submit, Enter in the box) waits while the text is not done:
 * it is kept and shown the moment it is. Any other move shows when the model is sure of it. */
function heldForText(plan:Plan){
 const f=fieldOf(deepActive());if(!f||finished.has(f.el)||!snapshot(f)?.text.trim()||!writing(f))return false;
 const s=plan.steps[0];if(!s)return false;
 if(s.do==='key')return /enter/i.test(s.combo??'');
 if(s.do!=='click')return false;
 const el=findTarget(targetOf(s));return !!el&&irreversible(toAction(s),el);
}
const touches=(s:PlanStep)=>!!(s.id||s.name||s.at);
/** What the chip says: the model's words when they name the element it outlines, else that element's own name on the page
 * ("Click “Post comment”"). The words and the outline then always mean the same thing, whatever the model called it. */
/** The move goes where the model's words say. Its words name what it means ("Send the message", "Open Assignments"); the
 * id it picked can be a neighbour. When the chosen element's name is not in its words but another element's on the page
 * is, the move is aimed at that one, so the outline, the label and what Tab presses are all the thing it meant. */
function aimed(plan:Plan):Plan{
 const first=plan.steps[0];if(!first?.id||first.do==='type'||first.at)return plan;
 const said=plan.label.toLowerCase(),wordsOf=(name:string)=>squash(name).toLowerCase().split(' ').filter(w=>w.length>2);
 const fit=(name:string)=>{const w=wordsOf(name);return w.length?w.filter(x=>said.includes(x)).length/w.length:0;};
 const chosen=findTarget(targetOf(first));if(chosen&&fit(nameOf(chosen,60))>=0.5)return plan;
 let best:{id:string;score:number}|undefined;
 for(const [id,item] of seen){
  const el=elementById(id);if(!el||!visible(el))continue;
  const score=fit(item.name)+(item.inView?0.01:0);if(score>=0.6&&(!best||score>best.score))best={id,score};
 }
 return best?{...plan,steps:[{...first,id:best.id},...plan.steps.slice(1)]}:plan;
}
function labelFor(plan:Plan,el?:Element){
 const first=plan.steps[0];if(!first||!el||plan.steps.length>1&&plan.steps.every(s=>s.do==='type'))return plan.label;
 const name=squash(nameOf(el,60)).toLowerCase();if(!name)return plan.label;
 const words=name.split(' ').filter(w=>w.length>2),said=plan.label.toLowerCase();
 return words.length&&words.some(w=>said.includes(w))?plan.label:labelOn(first,el);
}
const refused=new Map<string,number>();
/** The last move shown in full, so a click that put it away does not lose it. */
let lastPlan:{plan:Plan;href:string;at:number}|undefined;
/** The move they saw a moment ago comes back when nothing newer replaced it (a click elsewhere, a new guess that found
 * nothing): for a minute and a half, on the same page, while its target is still there and it was not turned down. */
function reshowLast(){
 const was=lastPlan;if(hint||running||taking||ghostShown()||!was||was.href!==location.href||Date.now()-was.at>90_000)return;
 const first=was.plan.steps[0];if(!first||Date.now()-(refused.get(stepKey(first))??0)<600_000||heldForText(was.plan))return;
 const el=touches(first)?findTarget(targetOf(first)):null;if(touches(first)&&!(el&&visible(el)))return;
 show(was.plan,true,'again');
}
function show(plan:Plan,final:boolean,source?:string){
 if(ghostShown())return;
 plan=aimed(plan);
 const first=plan.steps[0];
 if(Date.now()-(refused.get(stepKey(first))??0)<600_000)return;
 const el=touches(first)?findTarget(targetOf(first))??undefined:undefined;
 // A move that only types into the field they are in is words in that field: shown as the ghost is, taken the same way.
 const here=fieldOf(deepActive());
 const intoHere=plan.steps.length===1&&first?.do==='type'&&!!first.text&&!first.at&&!!here&&!!el&&(el===here.el||here.el.contains(el)||el.contains(here.el));
 // The chip it streamed in as goes first: the words are what is on screen now.
 if(intoHere&&final){if(chip)hide();if(offerWords(here!.el,first.text!,plan.confidence,plan.why)){wordsThen=plan.then?{el:here!.el,plan,at:Date.now()}:undefined;return;}}
 // The same move, further along: the line is updated in place, never flashed.
 if(chip&&hint&&hint.plan.steps[0]&&JSON.stringify(hint.plan.steps[0])===JSON.stringify(first)){hint={plan,el,final,source};chip.querySelector('.text')!.textContent=labelFor(plan,el);place();return;}
 if(taking)return;
 // Where the move on screen was: the new one glides there from it instead of popping up somewhere else.
 const from=chip&&rings[0]?{chip:chip.getBoundingClientRect(),ring:rings[0].getBoundingClientRect()}:undefined;
 hide();hint={plan,el,final,source};layer();raise();if(final)lastPlan={plan,href:location.href,at:Date.now()};
 // A small tag beside what the move touches, one line, that never takes a click: the page stays usable under it.
 chip=document.createElement('div');chip.className='move';chip.setAttribute('role','status');chip.title=plan.why?`${plan.label}: ${plan.why}`:plan.label;
 const key=document.createElement('kbd');key.textContent=TAKE_KEY;const text=document.createElement('span');text.className='text';text.textContent=labelFor(plan,el);
 chip.append(key,text);surface().appendChild(chip);moveShown(true,plan.confidence);
 // Everything the move touches is outlined (a drag's drop dashed), and what it would type shows faintly in each field.
 marked=plan.steps.flatMap((step):Mark[]=>{
  // A spot on a drawing is marked with a dot (a drag's drop, a dashed one).
  if(step.at)return[{el:document.documentElement,to:false,point:step.at},...(step.toAt?[{el:document.documentElement,to:true,point:step.toAt}]:[])];
  // An item hidden in a menu that opens on hover is marked on the menu's trigger.
  const found=touches(step)?findTarget(targetOf(step)):null,at=found&&!visible(found)?hoverOwner(found)??found:found,drop=step.do==='drag'&&step.to?findTarget(targetOf({do:'click',id:step.to})):null;
  return[...(at?[{el:at,to:false,text:step.do==='type'?step.text:undefined}]:[]),...(drop?[{el:drop,to:true}]:[])];
 });
 for(const m of marked)if(m.point||visible(m.el)){const ring=document.createElement('div');ring.className='tab-ring'+(m.point?' dot':'')+(m.to?' to':'');surface().appendChild(ring);rings.push(ring);m.ring=ring;}
 place();follow();if(from)glide(from);
}
/** The outline and its label move and resize from where the last move was to the new target, in a fifth of a second
 * (following the element as the page scrolls stays immediate). */
function glide(from:{chip:DOMRect;ring:DOMRect}){
 const ring=rings[0],box=chip;if(!box||!ring)return;
 const to={chip:[box.style.left,box.style.top],ring:[ring.style.left,ring.style.top,ring.style.width,ring.style.height]};
 const ease="cubic-bezier(.2,.8,.2,1)",t=["left","top","width","height"].map(p=>p+" .22s "+ease).join(",");
 for(const el of [box,ring]){el.style.transition="none";el.style.animation="none";}
 Object.assign(box.style,{left:from.chip.left+"px",top:from.chip.top+"px"});
 Object.assign(ring.style,{left:from.ring.left+"px",top:from.ring.top+"px",width:from.ring.width+"px",height:from.ring.height+"px"});
 void ring.offsetWidth;
 box.style.transition=t;ring.style.transition=t;
 Object.assign(box.style,{left:to.chip[0],top:to.chip[1]});Object.assign(ring.style,{left:to.ring[0],top:to.ring[1],width:to.ring[2],height:to.ring[3]});
 setTimeout(()=>{box.style.transition="";ring.style.transition="";},260);
}
/** The outline stays on what it marks while the move shows: the page moves under it (a dropdown opens, content loads in,
 * it scrolls, a framework draws the element again), so every frame its place is checked, and redrawn when it changed.
 * An element the page replaced is found again by its step; one that is gone or hidden takes the move with it, rather
 * than leaving an outline on empty space or on something else. */
let following=0;
function follow(){
 cancelAnimationFrame(following);let last='';
 const tick=()=>{
  if(!chip||!hint)return;
  for(const m of marked){
   if(m.point||m.el.isConnected)continue;
   const step=hint.plan.steps.find(s=>touches(s)&&!s.at),again=step?findTarget(targetOf(step)):null;
   if(!again){hide();return;}
   m.el=again;
  }
  const first=marked.find(m=>!m.point);
  if(first){const r=first.el.getBoundingClientRect();if(!r.width&&!r.height&&!(first.el===document.documentElement)){hide();return;}}
  const now=marked.map(m=>{if(m.point)return 'p';const r=m.el.getBoundingClientRect();return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;}).join(';');
  if(now!==last){last=now;place();}
  following=requestAnimationFrame(tick);
 };
 following=requestAnimationFrame(tick);
}
type Mark={el:Element;to:boolean;text?:string;ring?:HTMLDivElement;point?:[number,number]};
let marked:Mark[]=[];
/** The words a move would type, faintly, where they would land: at the caret in the field the cursor is in, at the start
 * of any other empty field it fills. A field that already has text keeps it in view (its outline says it changes). */
function drawPreviews(){
 for(const g of previews)g.remove();previews=[];preview=null;
 const focus=fieldOf(deepActive());
 for(const m of marked){
  if(!m.text||!m.el.isConnected)continue;const field=fieldOf(m.el);if(!field)continue;
  const single=field.singleLine,text=single?m.text.split('\n')[0]:m.text;
  let g:HTMLDivElement|null=null;
  if(focus&&field.el===focus.el){const snap=snapshot(focus);if(!snap||snap.before.trim()||snap.after.trim())continue;const caret=caretOf(focus);if(caret)g=ghostAt(caret,text,single);}
  else if(empty(field.el))g=ghostIn(field.el,text,single);
  if(g){previews.push(g);preview??=g;}
 }
}
let previews:HTMLDivElement[]=[];
/** Faint text at the start of a field the cursor is not in, in the field's own font. */
function ghostIn(el:Element,text:string,single:boolean){
 const s=getComputedStyle(el),r=el.getBoundingClientRect(),px=(v:string)=>parseFloat(v)||0;
 const left=r.left+px(s.borderLeftWidth)+px(s.paddingLeft),width=Math.max(0,r.width-px(s.borderLeftWidth)-px(s.paddingLeft)-px(s.paddingRight)-px(s.borderRightWidth));
 const lineHeight=s.lineHeight==='normal'?px(s.fontSize)*1.2:px(s.lineHeight);
 const top=single?r.top+(r.height-lineHeight)/2:r.top+px(s.borderTopWidth)+px(s.paddingTop);
 const g=document.createElement('div');g.className='ghost';
 Object.assign(g.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:single?`${lineHeight}px`:`${Math.max(lineHeight,r.bottom-top-px(s.paddingBottom))}px`,overflow:'hidden',
  fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,letterSpacing:s.letterSpacing,lineHeight:`${lineHeight}px`,whiteSpace:single?'pre':'pre-wrap',color:`color-mix(in srgb, ${s.color} 42%, transparent)`});
 g.textContent=text;surface().appendChild(g);return g;
}
/** By the cursor (the focused field) or the thing it would touch; else the bottom corner. */
function place(){
 if(!chip||!hint)return;
 for(const m of marked){
  if(m.ring&&m.point)Object.assign(m.ring.style,{left:`${m.point[0]-9}px`,top:`${m.point[1]-9}px`,width:'18px',height:'18px'});
  else if(m.ring&&m.el.isConnected){const e=m.el.getBoundingClientRect();Object.assign(m.ring.style,{left:`${e.left-3}px`,top:`${e.top-3}px`,width:`${e.width+6}px`,height:`${e.height+6}px`});}
 }
 // The label is joined to the outline of what the move touches first, like a tab on its edge, so which box it means is
 // never in doubt: on its top left corner; else its bottom left; else beside it. Never over the page's own controls (a
 // Join or Search button right by the field) where another place is free. With no outline, by the field the cursor is
 // in; with nothing at all, in the bottom right corner.
 const first=marked.find(m=>m.ring&&!m.point),ring=first?.ring;
 chip.classList.remove('above','below','off-up','off-down');for(const g of rings)g.classList.remove('above','below');
 const anchor=(ring??marked.find(m=>m.ring)?.ring??fieldOf(deepActive())?.el) as Element|undefined;
 const r=anchor&&anchor.isConnected?anchor.getBoundingClientRect():null,c=chip.getBoundingClientRect();
 let left=innerWidth-c.width-16,top=innerHeight-c.height-16;
 // Just off screen (the Submit below the fold): the label waits at that edge, an arrow pointing the way.
 if(r&&(r.top>innerHeight||r.bottom<0)){
  const down=r.top>innerHeight;chip.classList.add(down?'off-down':'off-up');
  left=Math.min(Math.max(8,r.left),innerWidth-c.width-8);top=down?innerHeight-c.height-12:12;
 }
 else if(r){
  const target=(first?.el??fieldOf(deepActive())?.el) as Element|undefined;
  const covers=(x:number,y:number)=>[[x+4,y+c.height/2],[x+c.width/2,y+c.height/2],[x+c.width-4,y+c.height/2]].some(([px,py])=>{const under=document.elementFromPoint(px,py)?.closest('button,a[href],input,select,textarea,[role=button],[role=link],[contenteditable=true]');return !!under&&!!target&&under!==target&&!target.contains(under)&&!under.contains(target);});
  const fits=(x:number,y:number)=>x>=4&&y>=4&&x+c.width<=innerWidth-4&&y+c.height<=innerHeight-4;
  const x=Math.min(Math.max(4,r.left),innerWidth-c.width-4),middle=r.top+(r.height-c.height)/2;
  const spots:[number,number,string][]=[[x,r.top-c.height,'above'],[x,r.bottom,'below'],[r.right+6,middle,''],[r.left-c.width-6,middle,'']];
  const [sx,sy,side]=spots.find(([a,b])=>fits(a,b)&&!covers(a,b))??spots.find(([a,b])=>fits(a,b))??spots[0];
  left=sx;top=sy;
  if(side&&ring&&Math.abs(sx-r.left)<1){chip.classList.add(side);ring.classList.add(side);}
 }
 chip.style.left=`${Math.round(left)}px`;chip.style.top=`${Math.round(Math.min(Math.max(4,top),innerHeight-c.height-4))}px`;
 drawPreviews();
}
function hide(){cancelAnimationFrame(following);if(chip)moveShown(false);chip?.remove();for(const r of rings)r.remove();for(const g of previews)g.remove();chip=null;rings=[];previews=[];preview=null;marked=[];hint=null;cycle=null;}
/** A move in words, by what each step touched ("type “…” into Street address", "drag “Write tests” onto “Done”"), so it
 * can be shown to the model later as what this person took or turned down, and labelled when it is the next move. */
function wordsOf(plan:{steps:PlanStep[]}){
 const at=(s:PlanStep,id?:string)=>{const i=id?seen.get(id):undefined;const name=i?.name??(id===s.id?s.name:undefined);return name?`“${name.slice(0,50)}”`:i?.role??s.role??'it';};
 return plan.steps.map(s=>s.do==='type'?`type “${(s.text??'').slice(0,80)}” into ${at(s,s.id)}`:s.do==='select'?`choose “${s.option}” in ${at(s,s.id)}`:s.do==='key'?`press ${s.combo}`:s.do==='open'?`open ${s.url}`:s.do==='back'?'go back':s.do==='drag'?`drag ${at(s,s.id)}${s.to?` onto ${at(s,s.to)}`:''}`:s.do==='scroll'?`scroll to ${at(s,s.id)}`:s.do==='hover'?`point at ${at(s,s.id)}`:`${s.do==='double_click'?'double-click':s.do==='right_click'?'right-click':'click'} ${at(s,s.id)}`).join('; ');
}

function onKey(event:KeyboardEvent){
 if(!alive())return;
 if(event.isComposing)return;
 // A text suggestion turned down: the move kept behind it shows after the beat.
 if(event.key==='Escape'&&ghostShown()&&!waitEnter){const f=fieldOf(deepActive());if(f)setTimeout(()=>task(f.el,BEAT,true),0);}
 // A final step armed by the first press: a second press (or Enter) does it; Esc, or anything else, lets it go.
 if(waitEnter){
  if(takes(event)||event.key==='Enter'){if(takes(event))took(event);else{event.preventDefault();event.stopImmediatePropagation();}waitEnter(true);}
  else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();waitEnter(false);}
  else if(!['Shift','Control','Alt','AltGraph','Meta','CapsLock'].includes(event.key))waitEnter(false);
  return;
 }
 // Alt+Q with no move shown in a task: the page guess, as their pointer and typing stand right now.
 if(takes(event)&&!hint&&!running&&!ghostShown()){const now=takeNow();if(now){hint={plan:now.plan,el:now.el,final:true,source:'page'};took(event);clearLikely();void go();}return;}
 // Alt and + (Alt and − back): the next or the previous likely move (after the one shown, or as the page ranks them now), shown in
 // its place, with its outline; Alt+Q takes the one shown. A text suggestion showing has these keys first.
 const dir=cycles(event);
 if(dir&&!running&&!taking&&!ghostShown()){
  const options=cycle?.plans??movesHere();
  if(options.length>1){
   took(event);const at=cycle?(cycle.at+dir+options.length)%options.length:(dir>0?1:options.length-1);
   show({...options[at],label:`${options[at].label} (${at+1}/${options.length})`},true,'cycle');cycle={plans:options,at};
  }
  return;
 }
 if(!hint||running)return;
 // A text suggestion showing has the keys, unless it was the move they saw when they pressed Tab.
 if(ghostShown()&&!(takes(event)&&mayTake('move')&&!mayTake('text'))){hide();return;}
 if(takes(event)&&mayTake('move')){took(event);void go();return;}
 if(event.key==='Escape'){
  event.preventDefault();event.stopImmediatePropagation();
  // Turned down: the guess still on its way is stopped, and this move does not come back on this page for a while.
  refused.set(stepKey(hint.plan.steps[0]),Date.now());stopListening?.();if(asking){post({type:'cancel',id:asking});asking=undefined;}
  post({type:'actions.outcome',label:hint.plan.label,outcome:'dismissed'});post({type:'predict.no',label:hint.plan.label,first:hint.plan.steps[0],page:document.title,did:wordsOf(hint.plan)});did('turned down',hint.plan.label);hide();return;}
 if(!['Shift','Control','Alt','AltGraph','Meta','CapsLock'].includes(event.key)){post({type:'actions.outcome',label:hint.plan.label,outcome:'ignored'});hide();}
}
/** The moves Alt and + goes through: the one shown and the others the guess ranked likely; with nothing shown, the page's
 * likely moves as the pointer and typing rank them now. */
let cycle:{plans:Plan[];at:number}|null=null;
function movesHere():Plan[]{
 if(!hint)return likelyMoves().map(m=>m.plan);
 const first=hint.plan.steps[0]?.id;
 return[hint.plan,...(hint.plan.likely??[]).filter(l=>l.id!==first&&findTarget(targetOf({do:'click',id:l.id}))).map(l=>({label:l.label,confidence:l.p,steps:[{do:(l.do??'click') as PlanStep['do'],id:l.id}]}))];
}
/** A step's element: by its id, or, if the page re-rendered it, by what it was (its role, name, the words around it); a
 * next move not yet on the page when it was guessed, by the role and name the model gave it. */
const targetOf=(s:PlanStep):Target=>{if(s.at)return{point:s.at};const i=s.id?seen.get(s.id):undefined;return s.id?{id:s.id,...(i?{role:i.role,name:i.name,nearby:i.nearby,path:i.path}:{})}:{role:s.role,name:s.name};};
function toAction(s:PlanStep):Action{
 const target=targetOf(s);
 switch(s.do){
  case 'type':return{do:'type',target,text:s.text!};
  case 'select':return{do:'select',target,option:s.option!};
  case 'key':return{do:'key',combo:s.combo!,...(touches(s)?{target}:{})};
  case 'drag':return{do:'drag',target,...(s.toAt?{to:{point:s.toAt}}:s.to?{to:targetOf({do:'click',id:s.to})}:{by:s.by})};
  case 'scroll':return{do:'scroll',to:target};
  case 'back':return{do:'back'};
  case 'double_click':case 'right_click':case 'hover':return{do:s.do,target};
  default:return{do:'click',target};
 }
}
/** Does the move: each step checked as it goes; one that sends, buys or deletes waits for Enter. A move still streaming
 * is finished first (a moment at most); one that came at once (a habit, their own details) is whole already. Then the
 * next move, already guessed, shows at once; the fresh guess that follows replaces it if it sees better. */
async function go(){
 if(!hint||taking)return;
 if(hint.source==='stream'&&!hint.final&&asking){
  taking=true;chip?.querySelector('.text')?.append('…');
  await new Promise<void>(r=>{finalArrived=r;setTimeout(r,2000);});finalArrived=null;taking=false;
 }
 const current=hint;if(!current)return;
 hide();lastPlan=undefined;running=true;let ok=true;
 // How to take each step back, kept as it is done: Undo (Ctrl+Z, a few seconds) takes them back in reverse.
 const undo:(()=>void)[]=[];let undoable=true;
 try{
  for(const step of current.plan.steps){
   if(step.do==='open'){post({type:'undo.note',label:current.plan.label});post({type:'actions.open',url:step.url});break;}
   const action=toAction(step),el=touches(step)?findTarget(targetOf(step)):null;if(el)lastTouched=el;
   // The page changed under it (the thing is gone): nothing is done, and the next guess looks again.
   if(touches(step)&&!el){ok=false;break;}
   if(irreversible(action,el)){undoable=false;const yes=await confirmEnter(nameOf(el!,40)||current.plan.label,el);if(!yes){ok=false;break;}}
   const back=inverseOf(step,el);if(back==='navigates')post({type:'undo.note',label:current.plan.label});else if(back)undo.push(back);else undoable=false;
   // On a drawing, with real clicks turned on, the move goes as real input; else as simulated pointer events.
   let result=step.at&&settings?.realInput?await request<Done>({type:'input.real',step},'input.done',8000)??{ok:false,detail:'Real input did not answer.'}:await perform(action);
   // Typing where a click on a drawing sent the cursor, in a frame (a document's hidden input): the engine types there.
   if(result.inFrame&&step.do==='type')result=await request<Done>({type:'tab.typeFocused',text:step.text},'tab.typed',5000)??{ok:false,detail:'Nothing took the typing.'};
   if(!result.ok){ok=false;post({type:'failure',site:location.hostname,editor:'page',what:'action',detail:`Tab: ${result.detail}`});break;}
   // A click Tab made for them is one of their steps too: habits learn from it.
   if(step.do==='click'&&el){const item=describe(el);if(item.name)post({type:'event',kind:'clicked',label:item.name,title:document.title,role:roleOf(el),name:item.name,path:item.path,nearby:item.nearby,learn:true});}
   if(current.plan.steps.length>1)await settled(40,300);
  }
 }finally{running=false;}
 if(ok&&undoable&&undo.length)offerUndo(current.plan.label,undo);
 did('took',wordsOf(current.plan));
 post({type:'actions.outcome',label:current.plan.label,outcome:ok?'accepted':'ignored'});if(ok)post({type:'predict.yes',page:document.title,did:wordsOf(current.plan)});
 const next=current.plan.then;
 if(ok&&next){
  await settled(60,500);
  const el=touches(next)?findTarget(targetOf(next)):null;
  // The part after stays where the task is (or in what the move opened: a menu, a dialog); one elsewhere is dropped.
  const scope=lastTouched?.isConnected?scopeOf(lastTouched):null;
  const here=!el||!scope||scope.contains(el)||!!el.closest('dialog,[role=dialog],[role=alertdialog],[role=menu],[role=listbox]');
  if((!touches(next)||el)&&here)show({label:labelOn(next,el),confidence:current.plan.confidence,steps:[next]},true,'then');
 }
 // What Tab just did is a task moment too, where it did it (a menu it opened, the form it filled).
 if(current.source==='page')page(150);else task(lastTouched??working,next?60:150,!!next);
}
let lastTouched:Element|null=null;
/** How a step is taken back, read before it is done: a field's text put back, a choice or a box as it was, a toggle
 * pressed again, the scroll where it was. A step that leaves the page (a link, an address) is taken back by going back
 * (the engine remembers it for the next page). undefined: it cannot be (a plain button: what it did is the site's). */
function inverseOf(step:PlanStep,el:Element|null):(()=>void)|'navigates'|undefined{
 if(step.do==='back')return 'navigates';
 if(step.do==='scroll'){const y=scrollY,x=scrollX;return()=>scrollTo(x,y);}
 if(!el)return;
 if(step.do==='type'){
  if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){const old=el.value,proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;return()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,old);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContent'}));el.dispatchEvent(new Event('change',{bubbles:true}));};}
  if((el as HTMLElement).isContentEditable)return()=>{(el as HTMLElement).focus();document.execCommand('undo');};
  return;
 }
 if(step.do==='select'&&el instanceof HTMLSelectElement){const old=el.value;return()=>{el.value=old;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};}
 if(step.do==='click'){
  const link=el.closest('a[href]') as HTMLAnchorElement|null;
  if(link&&!link.target&&!link.href.startsWith('javascript:')&&new URL(link.href,location.href).href.split('#')[0]!==location.href.split('#')[0])return 'navigates';
  const toggle=el.closest('input[type=checkbox],input[type=radio],[role=checkbox],[role=switch],[role=tab],[aria-pressed],[aria-expanded],summary,details > summary');
  if(toggle){
   const state=(t:Element)=>t instanceof HTMLInputElement?String(t.checked):`${t.getAttribute('aria-checked')}|${t.getAttribute('aria-pressed')}|${t.getAttribute('aria-expanded')}|${t.getAttribute('aria-selected')}|${(t.closest('details') as HTMLDetailsElement|null)?.open}`;
   // A radio or a tab is taken back by choosing the one chosen before.
   if(toggle instanceof HTMLInputElement&&toggle.type==='radio'){const was=toggle.form?.querySelector<HTMLInputElement>(`input[type=radio][name="${CSS.escape(toggle.name)}"]:checked`)??document.querySelector<HTMLInputElement>(`input[type=radio][name="${CSS.escape(toggle.name)}"]:checked`);return was&&was!==toggle?()=>was.click():undefined;}
   if(toggle.getAttribute('role')==='tab'){const was=toggle.closest('[role=tablist]')?.querySelector<HTMLElement>('[role=tab][aria-selected=true]');return was&&was!==toggle?()=>was.click():undefined;}
   const before=state(toggle);return()=>{if(state(toggle)!==before)(toggle as HTMLElement).click();};
  }
 }
}
/** Undo, for a few seconds after a move: a small chip by what it touched, Ctrl+Z (only while it shows) or a click. */
let undoChip:HTMLDivElement|null=null,undoKey:((e:KeyboardEvent)=>void)|null=null;
function offerUndo(label:string,undo:(()=>void)[],at?:Element|null){
 clearUndo();layer();
 const box=document.createElement('div');box.className='chip';box.style.pointerEvents='auto';
 const key=document.createElement('kbd');key.textContent='Ctrl+Z';const text=document.createElement('span');text.className='text';text.textContent=`Undo “${label}”`;
 box.append(text,key);surface().appendChild(box);undoChip=box;
 const r=(at??lastTouched)?.isConnected?(at??lastTouched)!.getBoundingClientRect():null;
 box.style.left=`${Math.max(8,Math.min(r?r.left:innerWidth-280,innerWidth-300))}px`;box.style.top=`${r?Math.min(r.bottom+6,innerHeight-44):innerHeight-60}px`;
 const run=()=>{clearUndo();for(const back of undo.slice().reverse())try{back();}catch{}post({type:'actions.outcome',label,outcome:'undone'});post({type:'predict.no',label,page:document.title,did:`undid: ${label}`});did('undid',label);};
 box.addEventListener('click',run);
 undoKey=e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();run();}};
 window.addEventListener('keydown',undoKey,true);
 const t=setTimeout(clearUndo,6000);box.dataset.timer=String(t);
}
function clearUndo(){undoChip?.remove();undoChip=null;if(undoKey)window.removeEventListener('keydown',undoKey,true);undoKey=null;}
/** A move that left the last page (a link Tab followed, an address it opened): on this one, Undo goes back. */
async function undoArrival(){
 if(inFrame)return;
 const pending=await request<{label?:string}>({type:'undo.pending'},'undo.pending',3000);
 if(!pending?.label)return;
 offerUndo(pending.label,[()=>post({type:'undo.back'})],null);
}
/** A next move's line, from what it touches now. */
function labelOn(s:PlanStep,el:Element|null){
 const name=el?nameOf(el,40):s.name,on=name?` “${name}”`:'';
 return s.do==='type'?`Type “${(s.text??'').slice(0,30)}”`:s.do==='select'?`Choose “${s.option}”`:s.do==='key'?`Press ${s.combo}`:s.do==='open'?`Open ${(()=>{try{return new URL(s.url!).hostname;}catch{return 'the page';}})()}`:s.do==='back'?'Go back':s.do==='drag'?`Drag${on}`:s.do==='scroll'?`Scroll to${on}`:s.do==='hover'?`Open${on}`:s.do==='double_click'?`Double-click${on}`:s.do==='right_click'?`Right-click${on}`:`Click${on}`;
}
/** A final step (send, submit, post, pay, delete) takes a second press: the first one arms it, and the chip says so by
 * the thing it would press. A wrong guess, a confusing page or a stray key never sends anything. */
function confirmEnter(what:string,at?:Element|null):Promise<boolean>{
 // As the move's label looked, on the same outline, pulsing: the eye is already there.
 layer();const box=document.createElement('div');box.className='move armed above';
 const key=document.createElement('kbd');key.textContent=TAKE_KEY;const text=document.createElement('span');text.className='text';text.textContent=`again to ${what} · Esc: not now`;
 box.append(key,text);surface().appendChild(box);
 const el=at?.isConnected?at:deepActive(),r=el?.getBoundingClientRect(),c=box.getBoundingClientRect();
 let ring:HTMLDivElement|undefined;
 if(r){ring=document.createElement('div');ring.className='tab-ring above';Object.assign(ring.style,{left:`${r.left-3}px`,top:`${r.top-3}px`,width:`${r.width+6}px`,height:`${r.height+6}px`});surface().appendChild(ring);}
 box.style.left=`${Math.max(4,Math.min((r?.left??innerWidth)-3,innerWidth-c.width-4))}px`;box.style.top=`${Math.max(4,(r?.top??innerHeight)-3-c.height)}px`;
 return new Promise(resolve=>{const t=setTimeout(()=>waitEnter?.(false),6000);waitEnter=yes=>{clearTimeout(t);waitEnter=null;box.remove();ring?.remove();resolve(yes);};});
}
/** What Tab would do now (for the engine's checks and the tests). */
export const predictState=()=>({glow:glowState(),showing:!!chip,label:hint?.plan.label,steps:hint?.plan.steps.length??0,waiting:!!waitEnter,final:hint?.final??false,source:hint?.source,preview:preview?.textContent??undefined,previews:previews.map(p=>p.textContent),outlined:rings.length,plan:hint?.plan,chipRect:chip?(r=>[r.left,r.top,r.width,r.height])(chip.getBoundingClientRect()):undefined});
