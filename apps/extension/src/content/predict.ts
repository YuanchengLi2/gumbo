/// <reference types="chrome" />
import {roleOf,nameOf,deepActive,visible} from './dom';
import {describe,pageModel,type Item} from './perceive';
import {fieldOf,inPaymentFrame} from './fields/field';
import {snapshot} from './fields/text';
import {perform,irreversible,findTarget,type Action,type Target} from './act';
import {pageText} from './capture';
import {surface,layer} from './ui/root';
import {ghostShown,ghostAt} from './ui/ghost';
import {caretOf} from './fields/caret';
import {post,listen as portListen} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import type {Plan,PlanStep} from '../shared/plan';
/** Tab for actions, on any page: as the user works, Gumbo guesses what would help next (fill in a form, choose the usual
 * option, click through, reply, run the search) and shows it in one small line by the cursor, the thing it would touch
 * lightly outlined. Tab does it, all of it, at once. A step that sends, buys or deletes waits for Enter; Esc dismisses.
 * It steps aside while a text suggestion shows, while the user is mid-word, and where Gumbo is off. Each click on the
 * page is reported (its role and name, never what was typed), so habits are learned.
 * It asks the moment the page has settled after what the user did (a click, a choice, a new route, a dialog opening),
 * not after a fixed wait, and the older question is cancelled; the guess shows as soon as its first steps have arrived. */
let pressed:{el:Element;at:number}|undefined,preview:HTMLDivElement|null=null,settings:Settings|undefined,hint:{plan:Plan;el?:Element;final:boolean;source?:string}|null=null,chip:HTMLDivElement|null=null,ring:HTMLDivElement|null=null;
let timer:number|undefined,wave=0,seq=0,asking:string|undefined,lastKey=0,running=false,taking=false,waitEnter:((yes:boolean)=>void)|null=null,finalArrived:(()=>void)|null=null;
/** The elements the current guess was made from, so a step finds its element again if the page re-rendered it. */
let seen=new Map<string,Item>();
const activity:{kind:string;label:string;text?:string}[]=[];
const active=()=>!!settings&&activeOn(settings,location.hostname)&&!inPaymentFrame();
const actionable='a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],summary,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],label';
const dialogs='[role=dialog],[role=alertdialog],dialog,[aria-modal=true]';
const did=(kind:string,label:string,text?:string)=>{const prev=activity.at(-1);if(prev&&prev.kind===kind&&prev.label===label)activity.pop();activity.push({kind,label:label.slice(0,80),text:text?.slice(-200)});if(activity.length>10)activity.shift();};

export function startPredict(){
 if(window!==window.top)return;
 void loadSettings().then(s=>{settings=s;soon(500);});onSettings(s=>{settings=s;if(!active())hide();});
 did('opened',document.title);
 document.addEventListener('click',onClick,true);
 document.addEventListener('pointerover',onRest,true);
 // A press on a field starts the guess at once (the focus and the click follow a moment later and are not waited for again).
 document.addEventListener('pointerdown',e=>{const t=e.composedPath()[0] as Element|undefined,f=t instanceof Element?fieldOf(t):null;if(f&&e.isTrusted){pressed={el:f.el,at:Date.now()};soon(0,true);}},true);
 document.addEventListener('focusin',()=>{const f=fieldOf(deepActive());if(hint)drawPreview();if(f){did('focused',nameOf(f.el,60)||'a field');if(!(pressed&&pressed.el===f.el&&Date.now()-pressed.at<500))soon(120,true);}},true);
 // The faint text belongs to the field the cursor is in: it goes when the cursor leaves.
 document.addEventListener('focusout',()=>{if(preview)setTimeout(()=>{if(hint)drawPreview();},0);},true);
 document.addEventListener('change',e=>{const t=e.target;if(t instanceof HTMLSelectElement){did('chose',nameOf(t,60),t.selectedOptions[0]?.text);soon(150);}else if(t instanceof HTMLInputElement&&/checkbox|radio/.test(t.type)){did(t.checked?'checked':'unchecked',nameOf(t,60));soon(150);}},true);
 // A finished sentence is a likely end of what they meant to write (the send, the search comes next): asked sooner.
 document.addEventListener('input',()=>{lastKey=Date.now();if(!running)hide();const f=fieldOf(deepActive());let ended=false;if(f){const s=snapshot(f);ended=/[.!?…]["”')]?\s*$/.test(s?.before??'');typingFor=ended?400:1100;did('typed',nameOf(f.el,60)||'a field',s?.before);}soon(ended?450:1300,true);},true);
 window.addEventListener('keydown',onKey,true);
 window.addEventListener('scroll',()=>requestAnimationFrame(place),{capture:true,passive:true});
 window.addEventListener('resize',()=>requestAnimationFrame(place));
 // A new route in an app that never reloads, and a dialog opening, are new moments to guess at.
 let href=location.href;
 setInterval(()=>{if(location.href!==href){href=location.href;did('went to',document.title||location.pathname);if(!running)hide();soon(250);}},600);
 new MutationObserver(records=>{
  for(const r of records)for(const n of r.addedNodes)if(n instanceof Element&&(n.matches(dialogs)||n.parentElement===document.body&&n.querySelector(dialogs))){did('saw a dialog',nameOf(n.matches(dialogs)?n:n.querySelector(dialogs)!,60)||'a dialog');soon(120);return;}
 }).observe(document.body??document.documentElement,{childList:true,subtree:true});
}
function onClick(event:MouseEvent){
 if(!event.isTrusted||(chip&&event.composedPath().includes(chip)))return;
 const target=(event.composedPath()[0] as Element|undefined)?.closest?.(actionable);
 if(active()&&target&&!fieldOf(target)){const item=describe(target);if(item.name){did('clicked',item.name);post({type:'capture.event',role:roleOf(target),name:item.name,path:item.path,nearby:item.nearby});}}
 // The click that ends a press on a field: its guess is already on the way (or showing).
 const f=target?null:fieldOf(event.composedPath()[0] as Element),same=!!(f&&pressed&&pressed.el===f.el&&Date.now()-pressed.at<800);
 if(same)return;
 if(!running)hide();soon(150);
}
/** Asks once the page has settled: a moment after what the user did, then until nothing has been added, removed, opened
 * or closed for a beat (a menu opening, a route loading), a second and a half at most. */
/** quick: what the user did changes little on the page (the cursor went into a field, they paused typing), so it waits
 * only a beat for the page, however busy the page itself keeps being. */
function soon(ms:number,quick=false){
 clearTimeout(timer);const mine=++wave;
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

const ask=(id:string,model:ReturnType<typeof pageModel>,moments:typeof activity,focused?:string)=>post({type:'predict',id,title:document.title,text:pageText(3500),items:model.items.map(i=>({id:i.id,role:i.role,name:i.name,value:i.value,state:i.state,inView:i.inView,nearby:i.nearby})),activity:moments,focused});
async function guess(){
 if(!active()||running||taking||typing()||document.visibilityState!=='visible')return;
 if(asking)post({type:'cancel',id:asking});
 const id=`p${++seq}`,model=pageModel(160),focus=fieldOf(deepActive());
 asking=id;seen=new Map(model.items.map(i=>[i.id,i]));
 listen(id);
 ask(id,model,activity,focus?nameOf(focus.el,60)||'a field':undefined);
}
/** Asked ahead: the pointer resting on a field is the moment before the user clicks into it, so the guess for "the
 * cursor is in that field" is asked then, exactly as it will be asked after the click; the engine keeps its answer, and
 * the click finds it ready. Nothing shows from this by itself. */
let restTimer:number|undefined,ahead=0;const askedAhead=new WeakMap<Element,number>();
function onRest(event:PointerEvent){
 clearTimeout(restTimer);
 const t=event.composedPath()[0],f=t instanceof Element?fieldOf(t):null;
 if(!f||!event.isTrusted||event.pointerType==='touch'||f.el===fieldOf(deepActive())?.el||Date.now()-(askedAhead.get(f.el)??0)<30_000)return;
 restTimer=window.setTimeout(()=>{
  if(!active()||running||taking||typing()||document.visibilityState!=='visible')return;
  askedAhead.set(f.el,Date.now());
  const name=nameOf(f.el,60)||'a field',last=activity.at(-1);
  // The moments as they will be once the click focuses it (did() keeps one entry for a repeat).
  const moments=last?.kind==='focused'&&last.label===name.slice(0,80)?activity:[...activity,{kind:'focused',label:name.slice(0,80)}].slice(-10);
  const model=pageModel(160);for(const i of model.items)seen.set(i.id,i);
  ask(`a${++ahead}`,model,moments,name);
 },150);
}
let stopListening:(()=>void)|undefined;
function listen(id:string){
 stopListening?.();
 // The instant guess (a habit, the user's own details) may come first, then the first steps as they stream; the whole
 // plan replaces them.
 stopListening=portListen(m=>{
  if(m?.type!=='predict.plan'||m.id!==id||Number(id.slice(1))!==seq)return;
  if(m.final){asking=undefined;finalArrived?.();}
  if(running||typing())return;
  if(m.plan)show(m.plan,!!m.final,m.source);else if(m.final&&hint&&!hint.final&&!taking)hide();
 });
}

function show(plan:Plan,final:boolean,source?:string){
 const first=plan.steps[0],el=first.id?findTarget(targetOf(first))??undefined:undefined;
 // The same guess, further along: the line is updated in place, never flashed.
 if(chip&&hint&&hint.plan.steps[0]&&JSON.stringify(hint.plan.steps[0])===JSON.stringify(first)){hint={plan,el,final,source};chip.querySelector('.text')!.textContent=plan.label;place();return;}
 if(taking)return;
 hide();hint={plan,el,final,source};layer();
 chip=document.createElement('div');chip.className='chip';chip.setAttribute('role','status');
 const key=document.createElement('kbd');key.textContent='Tab';const text=document.createElement('span');text.className='text';text.textContent=plan.label;
 chip.append(key,text);chip.addEventListener('mousedown',e=>{e.preventDefault();void go();});surface().appendChild(chip);
 if(el&&visible(el)){ring=document.createElement('div');ring.className='tab-ring';surface().appendChild(ring);}
 place();
}
/** Text its first step would type into the field the cursor is in (an empty one), shown faintly where it would land. */
function drawPreview(){
 preview?.remove();preview=null;
 const first=hint?.plan.steps[0],focus=fieldOf(deepActive());
 if(first?.do!=='type'||!first.text||!focus||!hint?.el||!(focus.el===hint.el||focus.el.contains(hint.el)||hint.el.contains(focus.el)))return;
 const snap=snapshot(focus);if(!snap||snap.before.trim()||snap.after.trim())return;
 const caret=caretOf(focus);if(caret)preview=ghostAt(caret,focus.singleLine?first.text.split('\n')[0]:first.text,focus.singleLine);
}
/** By the cursor (the focused field) or the thing it would touch; else the bottom corner. */
function place(){
 if(!chip||!hint)return;
 const anchor=(fieldOf(deepActive())?.el??hint.el) as Element|undefined,r=anchor&&anchor.isConnected?anchor.getBoundingClientRect():null,c=chip.getBoundingClientRect();
 chip.style.left=`${r?Math.min(Math.max(8,r.left),innerWidth-c.width-12):innerWidth-c.width-20}px`;
 chip.style.top=`${r?Math.min(r.bottom+6,innerHeight-c.height-12):innerHeight-c.height-20}px`;
 if(ring&&hint.el?.isConnected){const e=hint.el.getBoundingClientRect();Object.assign(ring.style,{left:`${e.left-3}px`,top:`${e.top-3}px`,width:`${e.width+6}px`,height:`${e.height+6}px`});}
 drawPreview();
}
function hide(){chip?.remove();ring?.remove();preview?.remove();chip=null;ring=null;preview=null;hint=null;}
/** A guess in words, by what each step touched ("type “…” into Street address; click “Continue”"), so it can be shown to
 * the model later as what this person took or turned down. */
function wordsOf(plan:Plan){
 const what=(s:PlanStep)=>{const i=s.id?seen.get(s.id):undefined;return i?.name?`“${i.name.slice(0,50)}”`:i?.role??'it';};
 return plan.steps.map(s=>s.do==='type'?`type “${(s.text??'').slice(0,80)}” into ${what(s)}`:s.do==='select'?`choose “${s.option}” in ${what(s)}`:s.do==='key'?`press ${s.combo} in ${what(s)}`:s.do==='open'?`open ${s.url}`:`click ${what(s)}`).join('; ')+(plan.more?' (and carry on)':'');
}

function onKey(event:KeyboardEvent){
 if(event.isComposing)return;
 if(waitEnter){if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();waitEnter(event.key==='Enter');}return;}
 if(!hint||running)return;
 if(ghostShown()){hide();return;}
 if(event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();void go();return;}
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();post({type:'actions.outcome',label:hint.plan.label,outcome:'dismissed'});post({type:'predict.no',label:hint.plan.label,first:hint.plan.steps[0],page:document.title,did:wordsOf(hint.plan)});did('turned down',hint.plan.label);hide();return;}
 if(!['Shift','Control','Alt','Meta','CapsLock'].includes(event.key)){post({type:'actions.outcome',label:hint.plan.label,outcome:'ignored'});hide();}
}
/** A step's element: by its id, or, if the page re-rendered it, by what it was (its role, name, the words around it). */
const targetOf=(s:PlanStep):Target=>{const i=s.id?seen.get(s.id):undefined;return{id:s.id,...(i?{role:i.role,name:i.name,nearby:i.nearby,path:i.path}:{})};};
const toAction=(s:PlanStep):Action=>s.do==='type'?{do:'type',target:targetOf(s),text:s.text!}:s.do==='select'?{do:'select',target:targetOf(s),option:s.option!}:s.do==='key'?{do:'key',combo:s.combo!,target:targetOf(s)}:{do:'click',target:targetOf(s)};
/** Does it: every step, checked as it goes; one that sends, buys or deletes waits for Enter. A guess still streaming is
 * finished first (a moment at most); one that came at once (a habit, their own details) is whole already. */
async function go(){
 if(!hint||taking)return;
 if(hint.source==='stream'&&!hint.final&&asking){
  taking=true;chip?.querySelector('.text')?.append('…');
  await new Promise<void>(r=>{finalArrived=r;setTimeout(r,2000);});finalArrived=null;taking=false;
 }
 const current=hint;if(!current)return;
 hide();running=true;let ok=true,stuck=false;const done:string[]=[];
 try{
  for(const step of current.plan.steps){
   if(step.do==='open'){post({type:'actions.open',url:step.url});break;}
   const action=toAction(step),el=step.id?findTarget(targetOf(step)):null;
   // The page changed under it (the thing is gone): the agent works it out from what is there now.
   if(step.id&&!el){stuck=true;break;}
   if(irreversible(action,el)){
    const yes=await confirmEnter(`${nameOf(el!,40)||'this'}`);if(!yes){ok=false;break;}
   }
   const result=await perform(action);
   if(!result.ok){stuck=true;post({type:'failure',site:location.hostname,editor:'page',what:'action',detail:`Tab: ${result.detail}`});break;}
   done.push(result.detail);
   // A click Tab made for them is one of their steps too: habits learn from it.
   if(step.do==='click'&&el){const item=describe(el);if(item.name)post({type:'capture.event',role:roleOf(el),name:item.name,path:item.path,nearby:item.nearby});}
   // The next step's element may only appear once this one has taken effect (a menu, a dialog, the next field).
   await settled(120,900);
  }
  // What it was doing needs more than was on the page: the agent carries on from here, in the same loop it always uses.
  if(ok&&(current.plan.more||stuck))await carryOn(current.plan.label,done);
 }finally{running=false;}
 did('accepted',current.plan.label);
 post({type:'actions.outcome',label:current.plan.label,outcome:ok?'accepted':'ignored'});if(ok)post({type:'predict.yes',page:document.title,did:wordsOf(current.plan)});
 soon(150);
}
/** The agent finishing what Tab started, its progress in Tab's small line; a final step waits for Enter, Esc stops. */
function carryOn(task:string,did:string[]):Promise<void>{
 const id=`c${++seq}`;layer();
 const box=document.createElement('div');box.className='chip';const text=document.createElement('span');text.className='text';box.append(text);surface().appendChild(box);
 const r=deepActive()?.getBoundingClientRect();box.style.left=`${Math.max(8,Math.min(r?.left??innerWidth-300,innerWidth-320))}px`;box.style.top=`${Math.min((r?.bottom??innerHeight-60)+6,innerHeight-44)}px`;
 text.textContent=`${task}…`;
 return new Promise(resolve=>{
  let chat:string|undefined,confirm:string|undefined;
  const finish=()=>{stop();window.removeEventListener('keydown',key,true);box.remove();resolve();};
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Enter'&&confirm&&chat){e.preventDefault();e.stopImmediatePropagation();post({type:'agent.confirm',chat,id:confirm,yes:true});confirm=undefined;}
   else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(confirm&&chat){post({type:'agent.confirm',chat,id:confirm,yes:false});confirm=undefined;}else{if(chat)post({type:'agent.stop',chat});finish();}}
  };
  window.addEventListener('keydown',key,true);
  const stop=portListen(m=>{
   if(m?.type!=='tab.progress'||m.id!==id)return;chat=m.chat;confirm=m.confirm?.id;
   const last=m.steps?.at(-1);
   text.textContent=m.confirm?`Enter: ${m.confirm.text} (Esc: no)`:m.done?(m.said||task):last?`${task} · ${last.text}`:`${task}…`;
   if(m.done)setTimeout(finish,m.status==='failed'?3000:1400);
  });
  post({type:'tab.continue',id,task,did});
 });
}
function confirmEnter(what:string):Promise<boolean>{
 layer();const box=document.createElement('div');box.className='chip';
 const key=document.createElement('kbd');key.textContent='Enter';const text=document.createElement('span');text.className='text';text.textContent=`to ${what.toLowerCase()} (Esc: not now)`;
 box.append(key,text);surface().appendChild(box);
 const r=deepActive()?.getBoundingClientRect();box.style.left=`${Math.max(8,Math.min(r?.left??innerWidth-260,innerWidth-280))}px`;box.style.top=`${Math.min((r?.bottom??innerHeight-60)+6,innerHeight-44)}px`;
 return new Promise(resolve=>{waitEnter=yes=>{waitEnter=null;box.remove();resolve(yes);};});
}
/** What Tab would do now (for the engine's checks and the tests). */
export const predictState=()=>({showing:!!chip,label:hint?.plan.label,steps:hint?.plan.steps.length??0,waiting:!!waitEnter,final:hint?.final??false,preview:preview?.textContent??undefined,plan:hint?.plan});
