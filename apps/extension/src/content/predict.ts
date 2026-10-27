/// <reference types="chrome" />
import {takes,took,TAKE_KEY} from './keys';
import {roleOf,nameOf,deepActive,visible,squash} from './dom';
import {describe,pageModel,deepQuery,hoverOwner,type Item} from './perceive';
import {fieldOf,inPaymentFrame,unseenFrame} from './fields/field';
import {snapshot} from './fields/text';
import {perform,irreversible,findTarget,type Action,type Target,type Done} from './act';
import {pageText} from './capture';
import {surface,layer,raise} from './ui/root';
import {ghostShown,ghostAt} from './ui/ghost';
import {caretOf} from './fields/caret';
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
const did=(kind:string,label:string,text?:string)=>{const prev=activity.at(-1);if(prev&&prev.kind===kind&&prev.label===label)activity.pop();activity.push({kind,label:label.slice(0,80),text:text?.slice(-200)});if(activity.length>10)activity.shift();};
/** What a hand touched, in a few words: the card, row, item or control it belongs to. */
const what=(el?:Element|null)=>{if(!el)return 'something';const at=el.closest(`[draggable=true],[role=listitem],[role=row],li,tr,${actionable}`)??el;return nameOf(at,40)||squash((at as HTMLElement).innerText??'').slice(0,40)||roleOf(at);};

/** Every frame has Tab: a lesson, a quiz or an editor embedded from another site is guessed about on its own. A frame
 * guesses only once the user has worked in it (pressed, focused, typed: ads and widgets never ask), and its move hides
 * when the user goes elsewhere, so one move shows at a time. */
const inFrame=window!==window.top;let touched=!inFrame,opened=false;
/** The page's first moment, once it is in view: what to do here, and, asked ahead, the first empty field in view. */
function opening(){
 if(opened||inFrame||!settings||document.visibilityState!=='visible')return;
 opened=true;const first=emptyFieldsAfter()[0];if(first)aheadInto(first);
}
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
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!inFrame&&!opened)opening();});
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
 document.addEventListener('change',e=>{const t=e.target;if(t instanceof HTMLSelectElement){did('chose',nameOf(t,60),t.selectedOptions[0]?.text);task(t,150);}else if(t instanceof HTMLInputElement&&/checkbox|radio/.test(t.type)){did(t.checked?'checked':'unchecked',nameOf(t,60));task(t,150);}else if(t instanceof HTMLInputElement&&t.type==='range'){did('set',nameOf(t,60),t.value);task(t,150);}},true);
 document.addEventListener('paste',e=>{const f=fieldOf(deepActive());if(f&&e.isTrusted&&!running){did('pasted into',nameOf(f.el,60)||'a field',e.clipboardData?.getData('text/plain')?.slice(0,200));task(f.el,250,true);}},true);
 // A finished sentence is a likely end of what they meant to write (the send, the search comes next): asked sooner.
 // Only the user's own typing in a text field is typing: a slider moved, a box checked, or what Tab itself typed is not.
 document.addEventListener('input',e=>{
  if(running)return;
  const f=fieldOf(deepActive()),t=e.composedPath()[0];
  if(!f||!(t instanceof Node)||!(f.el===t||f.el.contains(t)))return;
  lastKey=Date.now();hide();
  const s=snapshot(f),ended=/[.!?…]["”')]?\s*$/.test(s?.before??'');typingFor=ended?250:1100;
  did('typed',nameOf(f.el,60)||'a field',s?.before);task(f.el,ended?300:1300,true);
  // Asked ahead of the pause: the moment a sentence ends, and every second and a half while the typing goes on.
  clearTimeout(typedTimer);typedTimer=window.setTimeout(aheadOfPause,ended?0:450);
  if(Date.now()-lastAhead>1500&&lastAhead)aheadOfPause();else if(!lastAhead)lastAhead=Date.now();
 },true);
 watchHands();
 for(const type of ['pointerdown','keydown'])window.addEventListener(type,e=>{if(e.isTrusted)lastInput=Date.now();},true);
 window.addEventListener('keydown',onKey,true);
 window.addEventListener('scroll',()=>requestAnimationFrame(place),{capture:true,passive:true});
 window.addEventListener('resize',()=>requestAnimationFrame(place));
 // A new route in an app that never reloads, and a dialog opening, are new moments to guess at.
 let href=location.href;
 // A new route is a new page: nothing is offered until they do something there.
 setInterval(()=>{if(location.href!==href){href=location.href;did('went to',document.title||location.pathname);if(!running)hide();}},600);
 // A dialog the user just opened (a click a moment ago) is a task moment, in that dialog; one the page opens by itself
 // is not.
 new MutationObserver(records=>{
  if(Date.now()-lastInput>1500)return;
  for(const r of records)for(const n of r.addedNodes)if(n instanceof Element&&(n.matches(dialogs)||n.parentElement===document.body&&n.querySelector(dialogs))){const d=n.matches(dialogs)?n:n.querySelector(dialogs)!;did('opened a dialog',nameOf(d,60)||'a dialog');task(d,120);return;}
 }).observe(document.body??document.documentElement,{childList:true,subtree:true});
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
 if(active()&&target&&!fieldOf(target)){const item=describe(target);if(item.name){did('clicked',item.name);post({type:'capture.event',role:roleOf(target),name:item.name,path:item.path,nearby:item.nearby});}}
 // A click on a drawing has no element to name: where it was (in the view's pixels) is what the next guess knows.
 else if(event.composedPath()[0] instanceof HTMLCanvasElement)did('clicked on the drawing',`at ${Math.round(event.clientX)}, ${Math.round(event.clientY)}`);
 // The click that ends a press on a field: its guess is already on the way (or showing).
 const f=target?null:fieldOf(event.composedPath()[0] as Element),same=!!(f&&pressed&&pressed.el===f.el&&Date.now()-pressed.at<800);
 if(same)return;
 if(!running)hide();
 // Only a click that starts or changes something here is a task moment (it opened a menu, chose a tab or an option,
 // ticked a box), or one on a drawing; a link or a button that takes them elsewhere is not: what comes next is there.
 const path=event.composedPath()[0] as Element|undefined;
 const toggle=path?.closest?.('[aria-haspopup],[aria-expanded],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],summary,label,input[type=checkbox],input[type=radio]');
 if(toggle)task(toggle,150);else if(path instanceof HTMLCanvasElement)task(null,150);
}
/** Asks once the page has settled: a moment after what the user did, then until nothing has been added, removed, opened
 * or closed for a beat (a menu opening, a route loading), a second and a half at most. quick: what the user did changes
 * little on the page (the cursor went into a field, they paused typing), so it waits only a beat for the page, however
 * busy the page itself keeps being. */
function soon(ms:number,quick=false){
 if(!touched)return;
 // A newer moment (the user did something) is not the return to the tab.
 clearTimeout(timer);const mine=++wave;returned=false;
 timer=window.setTimeout(()=>void (quick?settled(60,250):settled()).then(()=>{if(mine===wave)void guess();}),ms);
}
function settled(quiet=120,max=1500):Promise<void>{
 return new Promise(resolve=>{
  let t=setTimeout(done,quiet);const cap=setTimeout(done,max);
  const watch=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(done,quiet);});
  watch.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-expanded','aria-hidden','open','hidden','disabled']});
  function done(){clearTimeout(t);clearTimeout(cap);watch.disconnect();resolve();}
 });
}
/** Mid-word, or a text suggestion showing: the keyboard is the user's. */
let typingFor=1100;
const typing=()=>Date.now()-lastKey<typingFor||ghostShown();

let lastMoment='',lastMomentAt=0;
/** The next guess is for coming back to this tab: asked before the user does anything here (ahead, for thrift.ts). */
let returned=false;
const ask=(id:string,model:ReturnType<typeof pageModel>,moments:typeof activity,focused?:string,back=false,where?:{kind:string;text:string})=>post({type:'predict',id,title:document.title,text:pageText(1500),...(where?{where}:{}),items:model.items.map(i=>({id:i.id,role:i.role,name:i.name,value:i.value,state:i.state,inView:i.inView,nearby:i.nearby})),activity:moments,focused,ahead:back||id.startsWith('a'),
 // A clue: the user's own hand on this page a moment ago (only then may a move show; see the engine).
 clue:Date.now()-lastInput<20_000,
 // A page drawn as pixels: the engine looks at a picture of the view, and moves may point at spots in it.
 ...(!inFrame&&drawnSurface()?{drawn:true,view:[innerWidth,innerHeight]}:{})});
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
 const focused=fieldOf(deepActive()),moment=`${location.href}|${activity.length}|${JSON.stringify(activity.slice(-2))}|${focused?nameOf(focused.el,60):''}`;
 if(moment===lastMoment&&Date.now()-lastMomentAt<60_000)return;
 lastMoment=moment;lastMomentAt=Date.now();
 if(asking)post({type:'cancel',id:asking});
 const scope=working&&working.isConnected&&!drawnSurface()?scopeOf(working):null;
 const id=`p${++seq}`,model=scope?pageModel(50,scope):pageModel(160),focus=focused;
 asking=id;for(const i of model.items)seen.set(i.id,i);
 listen(id);
 const back=returned;returned=false;
 ask(id,model,activity,focus?nameOf(focus.el,60)||'a field':undefined,back,scope?whereOf(scope):undefined);
}
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
 ask(`a${++ahead}`,model,moments,name,false,whereOf(scope));
}
/** Asked ahead for the moment typing stops (a sentence ended, a pause began): the same question the pause will ask, so
 * the send, the search or the next field is ready when they look up. */
function aheadOfPause(){
 const f=fieldOf(deepActive());
 if(!f||!active()||running||taking||ghostShown()||document.visibilityState!=='visible'||(snapshot(f)?.text.trim().length??0)<8)return;
 lastAhead=Date.now();
 const scope=scopeOf(f.el),id=`a${++ahead}`,model=pageModel(50,scope);for(const i of model.items)seen.set(i.id,i);
 // Its answer is kept: when they stop, a move that does not hang on the exact words (the send, the search, the next
 // field) shows at once, while the guess for the final words is made.
 const stop=portListen(m=>{if(m?.type!=='predict.plan'||m.id!==id||!m.final)return;stop();if(m.plan)typedAhead={el:f.el,plan:m.plan,at:Date.now()};});
 setTimeout(stop,8000);
 ask(id,model,activity,nameOf(f.el,60)||'a field',false,whereOf(scope));
}
let typedAhead:{el:Element;plan:Plan;at:number}|undefined,lastAhead=0;
/** The move asked ahead while they typed, if it still holds now that they stopped: for this field, a few seconds old,
 * and typing nothing into it (what they wrote since would change that). */
function aheadForPause():Plan|undefined{
 const a=typedAhead,f=fieldOf(deepActive());
 if(!a||!f||a.el!==f.el||Date.now()-a.at>5000)return;
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
  if(running||typing())return;
  if(m.plan)show(m.plan,!!m.final,m.source);else if(m.final&&hint&&!hint.final&&!taking)hide();
 });
}

const touches=(s:PlanStep)=>!!(s.id||s.name||s.at);
const refused=new Map<string,number>();
function show(plan:Plan,final:boolean,source?:string){
 const first=plan.steps[0];
 if(Date.now()-(refused.get(stepKey(first))??0)<600_000)return;
 const el=touches(first)?findTarget(targetOf(first))??undefined:undefined;
 // The same move, further along: the line is updated in place, never flashed.
 if(chip&&hint&&hint.plan.steps[0]&&JSON.stringify(hint.plan.steps[0])===JSON.stringify(first)){hint={plan,el,final,source};chip.querySelector('.text')!.textContent=plan.label;place();return;}
 if(taking)return;
 hide();hint={plan,el,final,source};layer();raise();
 // A small tag beside what the move touches, one line, that never takes a click: the page stays usable under it.
 chip=document.createElement('div');chip.className='move';chip.setAttribute('role','status');chip.title=plan.label;
 const key=document.createElement('kbd');key.textContent=TAKE_KEY;const text=document.createElement('span');text.className='text';text.textContent=plan.label;
 chip.append(key,text);surface().appendChild(chip);
 // Everything the move touches is outlined (a drag's drop dashed), and what it would type shows faintly in each field.
 marked=plan.steps.flatMap((step):Mark[]=>{
  // A spot on a drawing is marked with a dot (a drag's drop, a dashed one).
  if(step.at)return[{el:document.documentElement,to:false,point:step.at},...(step.toAt?[{el:document.documentElement,to:true,point:step.toAt}]:[])];
  // An item hidden in a menu that opens on hover is marked on the menu's trigger.
  const found=touches(step)?findTarget(targetOf(step)):null,at=found&&!visible(found)?hoverOwner(found)??found:found,drop=step.do==='drag'&&step.to?findTarget(targetOf({do:'click',id:step.to})):null;
  return[...(at?[{el:at,to:false,text:step.do==='type'?step.text:undefined}]:[]),...(drop?[{el:drop,to:true}]:[])];
 });
 for(const m of marked)if(m.point||visible(m.el)){const ring=document.createElement('div');ring.className='tab-ring'+(m.point?' dot':'')+(m.to?' to':'');surface().appendChild(ring);rings.push(ring);m.ring=ring;}
 place();
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
 // Beside what the move touches first (its outline; else the field the cursor is in): to its right, centred on it; where
 // there is no room, just above its right end; with nothing to touch, in the bottom right corner.
 const anchor=(marked.find(m=>m.ring)?.ring??fieldOf(deepActive())?.el) as Element|undefined;
 const r=anchor&&anchor.isConnected?anchor.getBoundingClientRect():null,c=chip.getBoundingClientRect();
 let left=innerWidth-c.width-16,top=innerHeight-c.height-16;
 if(r){
  if(r.right+8+c.width<=innerWidth-8){left=r.right+8;top=r.top+(r.height-c.height)/2;}
  else{left=Math.max(8,r.right-c.width);top=r.top-c.height-6;if(top<8)top=r.bottom+6;}
 }
 chip.style.left=`${Math.round(left)}px`;chip.style.top=`${Math.round(Math.min(Math.max(8,top),innerHeight-c.height-8))}px`;
 drawPreviews();
}
function hide(){chip?.remove();for(const r of rings)r.remove();for(const g of previews)g.remove();chip=null;rings=[];previews=[];preview=null;marked=[];hint=null;}
/** A move in words, by what each step touched ("type “…” into Street address", "drag “Write tests” onto “Done”"), so it
 * can be shown to the model later as what this person took or turned down, and labelled when it is the next move. */
function wordsOf(plan:{steps:PlanStep[]}){
 const at=(s:PlanStep,id?:string)=>{const i=id?seen.get(id):undefined;const name=i?.name??(id===s.id?s.name:undefined);return name?`“${name.slice(0,50)}”`:i?.role??s.role??'it';};
 return plan.steps.map(s=>s.do==='type'?`type “${(s.text??'').slice(0,80)}” into ${at(s,s.id)}`:s.do==='select'?`choose “${s.option}” in ${at(s,s.id)}`:s.do==='key'?`press ${s.combo}`:s.do==='open'?`open ${s.url}`:s.do==='back'?'go back':s.do==='drag'?`drag ${at(s,s.id)}${s.to?` onto ${at(s,s.to)}`:''}`:s.do==='scroll'?`scroll to ${at(s,s.id)}`:s.do==='hover'?`point at ${at(s,s.id)}`:`${s.do==='double_click'?'double-click':s.do==='right_click'?'right-click':'click'} ${at(s,s.id)}`).join('; ');
}

function onKey(event:KeyboardEvent){
 if(!alive())return;
 if(event.isComposing)return;
 if(waitEnter){if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();waitEnter(event.key==='Enter');}return;}
 if(!hint||running)return;
 if(ghostShown()){hide();return;}
 if(takes(event)){took(event);void go();return;}
 if(event.key==='Escape'){
  event.preventDefault();event.stopImmediatePropagation();
  // Turned down: the guess still on its way is stopped, and this move does not come back on this page for a while.
  refused.set(stepKey(hint.plan.steps[0]),Date.now());stopListening?.();if(asking){post({type:'cancel',id:asking});asking=undefined;}
  post({type:'actions.outcome',label:hint.plan.label,outcome:'dismissed'});post({type:'predict.no',label:hint.plan.label,first:hint.plan.steps[0],page:document.title,did:wordsOf(hint.plan)});did('turned down',hint.plan.label);hide();return;}
 if(!['Shift','Control','Alt','AltGraph','Meta','CapsLock'].includes(event.key)){post({type:'actions.outcome',label:hint.plan.label,outcome:'ignored'});hide();}
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
 hide();running=true;let ok=true;
 try{
  for(const step of current.plan.steps){
   if(step.do==='open'){post({type:'actions.open',url:step.url});break;}
   const action=toAction(step),el=touches(step)?findTarget(targetOf(step)):null;if(el)lastTouched=el;
   // The page changed under it (the thing is gone): nothing is done, and the next guess looks again.
   if(touches(step)&&!el){ok=false;break;}
   if(irreversible(action,el)){const yes=await confirmEnter(`${nameOf(el!,40)||'this'}`);if(!yes){ok=false;break;}}
   // On a drawing, with real clicks turned on, the move goes as real input; else as simulated pointer events.
   let result=step.at&&settings?.realInput?await request<Done>({type:'input.real',step},'input.done',8000)??{ok:false,detail:'Real input did not answer.'}:await perform(action);
   // Typing where a click on a drawing sent the cursor, in a frame (a document's hidden input): the engine types there.
   if(result.inFrame&&step.do==='type')result=await request<Done>({type:'tab.typeFocused',text:step.text},'tab.typed',5000)??{ok:false,detail:'Nothing took the typing.'};
   if(!result.ok){ok=false;post({type:'failure',site:location.hostname,editor:'page',what:'action',detail:`Tab: ${result.detail}`});break;}
   // A click Tab made for them is one of their steps too: habits learn from it.
   if(step.do==='click'&&el){const item=describe(el);if(item.name)post({type:'capture.event',role:roleOf(el),name:item.name,path:item.path,nearby:item.nearby});}
   if(current.plan.steps.length>1)await settled(40,300);
  }
 }finally{running=false;}
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
 task(lastTouched??working,next?60:150,!!next);
}
let lastTouched:Element|null=null;
/** A next move's line, from what it touches now. */
function labelOn(s:PlanStep,el:Element|null){
 const name=el?nameOf(el,40):s.name,on=name?` “${name}”`:'';
 return s.do==='type'?`Type “${(s.text??'').slice(0,30)}”`:s.do==='select'?`Choose “${s.option}”`:s.do==='key'?`Press ${s.combo}`:s.do==='open'?`Open ${(()=>{try{return new URL(s.url!).hostname;}catch{return 'the page';}})()}`:s.do==='back'?'Go back':s.do==='drag'?`Drag${on}`:s.do==='scroll'?`Scroll to${on}`:s.do==='hover'?`Open${on}`:s.do==='double_click'?`Double-click${on}`:s.do==='right_click'?`Right-click${on}`:`Click${on}`;
}
function confirmEnter(what:string):Promise<boolean>{
 layer();const box=document.createElement('div');box.className='chip';
 const key=document.createElement('kbd');key.textContent='Enter';const text=document.createElement('span');text.className='text';text.textContent=`to ${what.toLowerCase()} (Esc: not now)`;
 box.append(key,text);surface().appendChild(box);
 const r=deepActive()?.getBoundingClientRect();box.style.left=`${Math.max(8,Math.min(r?.left??innerWidth-260,innerWidth-280))}px`;box.style.top=`${Math.min((r?.bottom??innerHeight-60)+6,innerHeight-44)}px`;
 return new Promise(resolve=>{waitEnter=yes=>{waitEnter=null;box.remove();resolve(yes);};});
}
/** What Tab would do now (for the engine's checks and the tests). */
export const predictState=()=>({showing:!!chip,label:hint?.plan.label,steps:hint?.plan.steps.length??0,waiting:!!waitEnter,final:hint?.final??false,source:hint?.source,preview:preview?.textContent??undefined,previews:previews.map(p=>p.textContent),outlined:rings.length,plan:hint?.plan});
