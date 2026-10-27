import {deepQuery,elementById,describe,idOf,pageModel,type Item} from './perceive';
import {nameOf,roleOf,visible,squash} from './dom';
import {fieldOf} from './fields/field';
import {insert} from './fields/insert';
import {snapshot} from './fields/text';
/** The action vocabulary, inside a page: every step on every site is a sequence of these. A target is found by id (from
 * the page model), else by role and accessible name, else by path, else by the text near it. Every action is checked
 * afterwards (something changed: the page, the address, the focus, the element's state or value); one that changed
 * nothing is tried once more another way (a native click, the keyboard), then reported. */
export type Target={id?:string;role?:string;name?:string;path?:string;nearby?:string;text?:string};
export type Action=
 |{do:'click';target:Target}
 |{do:'double_click';target:Target}
 |{do:'right_click';target:Target}
 |{do:'hover';target:Target}
 |{do:'drag';target:Target;to?:Target;by?:[number,number]}
 |{do:'type';target?:Target;text:string;replace?:boolean}
 |{do:'key';combo:string;target?:Target}
 |{do:'select';target:Target;option:string}
 |{do:'scroll';target?:Target;by?:number;to?:Target}
 |{do:'back'}
 |{do:'wait';for:{selector?:string;text?:string;urlChanges?:boolean;settled?:boolean};timeoutMs?:number}
 |{do:'read';target?:Target};
export type Done={ok:boolean;detail:string;changed?:boolean;item?:Item;value?:unknown;irreversible?:boolean};

/** Words that make a click or a key final: sending, posting, buying, deleting. These always wait for Enter. */
const finalWords=/\b(send|submit|post|publish|tweet|reply|delete|remove|discard|pay|purchase|buy|order|place order|checkout|confirm|transfer|sign|merge|deploy|unsubscribe|cancel (subscription|plan)|archive|block|report)\b/i;
export function irreversible(action:Action,el?:Element|null):boolean{
 if(action.do==='click'&&el){const name=nameOf(el,60);return finalWords.test(name)||(el instanceof HTMLButtonElement&&el.type==='submit'&&!!el.form)||(el instanceof HTMLInputElement&&el.type==='submit');}
 // Enter in a form submits it, unless it is a search (running a search changes nothing).
 if(action.do==='key'){const el=action.target?findTarget(action.target):null;return /(^|\+)enter$/i.test(action.combo)&&!!el?.closest('form')&&!el.closest('[role=search]')&&!(el instanceof HTMLInputElement&&el.type==='search');}
 return false;
}

export function findTarget(target:Target):Element|null{
 if(target.id){const el=elementById(target.id);if(el)return el;}
 const candidates=()=>deepQuery('a,button,input,textarea,select,summary,label,h1,h2,h3,h4,h5,h6,[role],[contenteditable=true],[tabindex],[onclick]').filter(visible);
 if(target.name){
  const want=squash(target.name).toLowerCase(),all=candidates();
  const scored=all.map(el=>{const name=nameOf(el,120).toLowerCase(),role=roleOf(el);let score=name===want?3:name.startsWith(want)?2:name.includes(want)?1:0;if(score&&target.role&&role===target.role)score+=2;
   // A label or a plain element named the same loses to the control itself.
   if(score&&(el.tagName==='LABEL'||role==='generic'))score-=0.5;
   // The words near it: the closer the ancestor that holds them, the surer the match (its row beats the whole page).
   if(score&&target.nearby){const near=target.nearby.toLowerCase().slice(0,40);let node=el.parentElement;for(let level=1;node&&level<=5;level++,node=node.parentElement)if(squash(node.innerText??'').toLowerCase().includes(near)){score+=2/level;break;}}
   return{el,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  if(scored.length)return scored[0].el;
 }
 if(target.path){try{const el=document.querySelector(target.path);if(el&&visible(el))return el;}catch{}}
 const text=(target.text??target.nearby)?.toLowerCase();
 if(text){const el=candidates().find(c=>squash((c as HTMLElement).innerText??'').toLowerCase().includes(text));if(el)return el;}
 return null;
}

export async function perform(action:Action):Promise<Done>{
 switch(action.do){
  case 'click':{
   const el=findTarget(action.target);if(!el)return{ok:false,detail:`Nothing on the page matches ${label(action.target)}.`};
   el.scrollIntoView({block:'center',inline:'nearest'});await frames(1);
   // A click focusing what it clicked is not the page reacting.
   let changed=await watch(()=>pointerClick(el),700,false);
   if(!changed&&el.isConnected){changed=await watch(()=>(el as HTMLElement).click(),700,false);}
   if(!changed&&el.isConnected){(el as HTMLElement).focus();changed=await watch(()=>keyPress(el,'Enter'),700,false);}
   return{ok:changed,changed,detail:changed?`Clicked ${nameOf(el,60)||roleOf(el)}.`:`Clicked ${nameOf(el,60)}, but nothing changed.`,item:el.isConnected?describe(el):undefined};
  }
  case 'type':{
   const el=action.target?findTarget(action.target):document.activeElement;
   const field=el?fieldOf(el instanceof HTMLElement&&el.isContentEditable?el:el):null;
   if(!field)return{ok:false,detail:'There is no field to type in there (or it is one Gumbo never types in).'};
   field.el.focus({preventScroll:false});
   const now=snapshot(field,1e9,1e9);
   // Some inputs (email, number) have no caret to read or place: their value is set the way typing would set it.
   if(!now&&field.el instanceof HTMLInputElement){
    const input=field.el,value=action.replace?action.text:input.value+action.text;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:action.text}));input.dispatchEvent(new Event('change',{bubbles:true}));
    return{ok:input.value===value,changed:true,detail:`Typed into ${nameOf(input,60)||'the field'}.`,item:describe(input)};
   }
   if(!now)return{ok:false,detail:'The field has no caret.'};
   const result=await insert(field,action.text,action.replace?{from:0,to:now.text.length}:{});
   return{ok:result.ok,changed:result.ok,detail:result.ok?`Typed into ${nameOf(field.el,60)||'the field'}.`:`Could not type into ${nameOf(field.el,60)||'the field'} (${result.reason}).`,item:describe(field.el)};
  }
  case 'key':{
   const el=(action.target?findTarget(action.target):null)??document.activeElement??document.body;
   const changed=await watch(()=>keyPress(el,action.combo));
   return{ok:true,changed,detail:`Pressed ${action.combo}.`};
  }
  case 'select':{
   const el=findTarget(action.target);if(!el)return{ok:false,detail:`Nothing on the page matches ${label(action.target)}.`};
   if(el instanceof HTMLSelectElement){
    const want=action.option.toLowerCase(),option=[...el.options].find(o=>o.text.toLowerCase()===want||o.value.toLowerCase()===want)??[...el.options].find(o=>o.text.toLowerCase().includes(want));
    if(!option)return{ok:false,detail:`${nameOf(el,40)} has no option "${action.option}".`};
    const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!;setter.call(el,option.value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    return{ok:el.value===option.value,changed:true,detail:`Chose ${option.text}.`};
   }
   // A custom list: open it, then click the option.
   await perform({do:'click',target:action.target});await frames(3);
   return perform({do:'click',target:{name:action.option,role:'option'}});
  }
  case 'double_click':case 'right_click':case 'hover':{
   const el=findTarget(action.target);if(!el)return{ok:false,detail:`Nothing on the page matches ${label(action.target)}.`};
   el.scrollIntoView({block:'center',inline:'nearest'});await frames(1);
   const what=action.do==='double_click'?'Double-clicked':action.do==='right_click'?'Right-clicked':'Pointed at';
   const changed=await watch(()=>action.do==='double_click'?doubleClick(el):action.do==='right_click'?rightClick(el):hover(el),700,false);
   return{ok:true,changed,detail:`${what} ${nameOf(el,60)||roleOf(el)}${changed?'':' (nothing visibly changed)'}.`,item:el.isConnected?describe(el):undefined};
  }
  case 'drag':{
   const el=findTarget(action.target);if(!el)return{ok:false,detail:`Nothing on the page matches ${label(action.target)}.`};
   const to=action.to?findTarget(action.to):null;if(action.to&&!to)return{ok:false,detail:`Nothing on the page matches ${label(action.to)} to drop it on.`};
   el.scrollIntoView({block:'center',inline:'nearest'});await frames(1);
   const changed=await watch(()=>drag(el,to,action.by),700,false);
   return{ok:true,changed,detail:`Dragged ${nameOf(el,40)||roleOf(el)}${to?` to ${nameOf(to,40)||roleOf(to)}`:''}${changed?'':' (nothing visibly changed)'}.`,item:el.isConnected?describe(el):undefined};
  }
  case 'scroll':{
   const to=action.to?findTarget(action.to):null;
   if(to){to.scrollIntoView({block:'center',behavior:'instant' as ScrollBehavior});return{ok:true,detail:`Scrolled to ${nameOf(to,40)||roleOf(to)}.`,item:describe(to)};}
   const el=action.target?findTarget(action.target):null,by=action.by??innerHeight*0.8;
   if(el)el.scrollBy({top:by,behavior:'instant' as ScrollBehavior});else window.scrollBy({top:by,behavior:'instant' as ScrollBehavior});
   return{ok:true,detail:`Scrolled ${by>0?'down':'up'}.`};
  }
  case 'back':{const url=location.href;history.back();const moved=await watch(()=>{},1500,false)||location.href!==url;return{ok:true,changed:moved,detail:'Went back.'};}
  case 'wait':return waitFor(action.for,action.timeoutMs??8000);
  case 'read':{
   if(!action.target)return{ok:true,detail:'Read the page.',value:pageModel()};
   const el=findTarget(action.target);if(!el)return{ok:false,detail:`Nothing on the page matches ${label(action.target)}.`};
   return{ok:true,detail:`Read ${nameOf(el,40)}.`,value:squash((el as HTMLElement).innerText??el.textContent??'').slice(0,4000),item:describe(el)};
  }
 }
}
const label=(t:Target)=>t.name?`"${t.name}"`:t.text?`"${t.text}"`:t.id??t.path??'that';
const frames=(n:number)=>new Promise<void>(resolve=>{const step=(k:number)=>k?requestAnimationFrame(()=>step(k-1)):resolve();step(n);});

/** Runs a step and says whether the page reacted within a moment: the DOM, the address, the focus or a value changed. */
async function watch(run:()=>void|Promise<unknown>,ms=700,countFocus=true):Promise<boolean>{
 const url=location.href,focus=document.activeElement;let mutated=false;
 const observer=new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Element&&r.target.tagName==='GUMBO-LAYER')))mutated=true;});
 observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 try{await run();}catch{}
 const until=Date.now()+ms;while(Date.now()<until&&!mutated&&location.href===url){await new Promise(r=>setTimeout(r,50));}
 observer.disconnect();
 return mutated||location.href!==url||(countFocus&&document.activeElement!==focus);
}
/** Real pointer events at the element's centre, as a mouse would send them. */
function pointerClick(el:Element){
 const rect=el.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
 const at=document.elementFromPoint(x,y),target=at&&(el.contains(at)||at.contains(el))?at:el;
 const base={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0,view:window};
 target.dispatchEvent(new PointerEvent('pointerover',{...base,pointerId:1,isPrimary:true}));target.dispatchEvent(new MouseEvent('mouseover',base));
 target.dispatchEvent(new PointerEvent('pointerdown',{...base,pointerId:1,isPrimary:true,buttons:1}));target.dispatchEvent(new MouseEvent('mousedown',{...base,buttons:1}));
 if(el instanceof HTMLElement)el.focus({preventScroll:true});
 target.dispatchEvent(new PointerEvent('pointerup',{...base,pointerId:1,isPrimary:true}));target.dispatchEvent(new MouseEvent('mouseup',base));
 target.dispatchEvent(new MouseEvent('click',base));
}
const centre=(el:Element)=>{const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};};
/** Mouse and pointer events of one kind at a point, on what is under it (or the element itself). */
function fire(el:Element,type:string,x:number,y:number,extra:Record<string,unknown>={}){
 const init={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,screenX:x,screenY:y,button:0,buttons:/up$|click$|^drop$|dragend/.test(type)?0:1,view:window,...extra};
 const Kind=type.startsWith('pointer')?PointerEvent:type.startsWith('drag')||type==='drop'?DragEvent:MouseEvent;
 return el.dispatchEvent(new Kind(type,type.startsWith('pointer')?{...init,pointerId:1,isPrimary:true,pointerType:'mouse'}:init));
}
function doubleClick(el:Element){pointerClick(el);pointerClick(el);const {x,y}=centre(el);fire(el,'dblclick',x,y,{detail:2,buttons:0});}
function rightClick(el:Element){
 const {x,y}=centre(el);
 fire(el,'pointerdown',x,y,{button:2,buttons:2});fire(el,'mousedown',x,y,{button:2,buttons:2});
 fire(el,'pointerup',x,y,{button:2,buttons:0});fire(el,'mouseup',x,y,{button:2,buttons:0});
 fire(el,'contextmenu',x,y,{button:2,buttons:0});
}
/** A menu or card that opens on hover (by script: a page's own :hover styles answer only to the real pointer). */
function hover(el:Element){
 const {x,y}=centre(el);
 for(const type of ['pointerover','pointerenter','mouseover','mouseenter','pointermove','mousemove'])fire(el,type,x,y,{buttons:0,bubbles:!type.endsWith('enter')});
}
/** A drag, as a hand makes it: press, move in small steps, release; with the native drag events too when the thing is
 * draggable (lists and boards built on HTML drag and drop), and a slider simply set where the drag would leave it. */
async function drag(el:Element,to:Element|null,by?:[number,number]){
 const from=centre(el),end=to?centre(to):{x:from.x+(by?.[0]??0),y:from.y+(by?.[1]??0)};
 if(el instanceof HTMLInputElement&&el.type==='range'){
  const r=el.getBoundingClientRect(),min=Number(el.min||0),max=Number(el.max||100),step=Number(el.step)||1;
  const value=Math.min(max,Math.max(min,Math.round((min+(end.x-r.left)/Math.max(1,r.width)*(max-min))/step)*step));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,String(value));
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return;
 }
 const at=(x:number,y:number)=>{const hit=document.elementFromPoint(x,y);return hit&&!hit.closest('gumbo-layer')?hit:document.body;};
 const native=el.closest('[draggable=true]'),data=new DataTransfer();
 fire(el,'pointerover',from.x,from.y,{buttons:0});fire(el,'pointerdown',from.x,from.y);fire(el,'mousedown',from.x,from.y);
 await frames(1);
 if(native)fire(native,'dragstart',from.x,from.y,{dataTransfer:data});
 let over:Element=el;
 for(let i=1;i<=14;i++){
  const x=from.x+(end.x-from.x)*i/14,y=from.y+(end.y-from.y)*i/14,under=at(x,y);
  fire(under,'pointermove',x,y);fire(under,'mousemove',x,y);
  if(native){if(under!==over)fire(under,'dragenter',x,y,{dataTransfer:data});fire(under,'dragover',x,y,{dataTransfer:data});if(native)fire(native,'drag',x,y,{dataTransfer:data});}
  over=under;await frames(1);
 }
 const target=at(end.x,end.y);
 if(native){fire(target,'drop',end.x,end.y,{dataTransfer:data});fire(native,'dragend',end.x,end.y,{dataTransfer:data});}
 fire(target,'pointerup',end.x,end.y);fire(target,'mouseup',end.x,end.y);
}
const keyCodes:Record<string,string>={enter:'Enter',escape:'Escape',esc:'Escape',tab:'Tab',space:' ',backspace:'Backspace',delete:'Delete',arrowdown:'ArrowDown',arrowup:'ArrowUp',arrowleft:'ArrowLeft',arrowright:'ArrowRight',home:'Home',end:'End',pagedown:'PageDown',pageup:'PageUp'};
export function keyPress(el:Element,combo:string){
 const parts=combo.split('+').map(p=>p.trim().toLowerCase()),key=parts.at(-1)!;
 const name=keyCodes[key]??(key.length===1?key:key[0].toUpperCase()+key.slice(1));
 const init={key:name,code:name.length===1?(/[a-z]/i.test(name)?'Key'+name.toUpperCase():/\d/.test(name)?'Digit'+name:''):name,bubbles:true,cancelable:true,composed:true,ctrlKey:parts.includes('ctrl')||parts.includes('control'),metaKey:parts.includes('meta')||parts.includes('cmd'),altKey:parts.includes('alt'),shiftKey:parts.includes('shift')};
 const down=el.dispatchEvent(new KeyboardEvent('keydown',init));
 if(down&&name.length===1)el.dispatchEvent(new KeyboardEvent('keypress',init));
 el.dispatchEvent(new KeyboardEvent('keyup',init));
 // A form's Enter submits it, which synthetic keys never do by themselves.
 if(down&&name==='Enter'&&el instanceof HTMLInputElement&&el.form)el.form.requestSubmit();
}
async function waitFor(condition:{selector?:string;text?:string;urlChanges?:boolean;settled?:boolean},timeoutMs:number):Promise<Done>{
 const url=location.href,until=Date.now()+timeoutMs;let last=Date.now();
 const observer=new MutationObserver(()=>{last=Date.now();});observer.observe(document,{subtree:true,childList:true,characterData:true});
 try{
  while(Date.now()<until){
   if(condition.selector){const el=deepQuery(condition.selector)[0];if(el&&visible(el))return{ok:true,detail:'It appeared.',item:describe(el)};}
   if(condition.text&&squash(document.body.innerText).toLowerCase().includes(condition.text.toLowerCase()))return{ok:true,detail:`"${condition.text}" is on the page.`};
   if(condition.urlChanges&&location.href!==url)return{ok:true,detail:`Went to ${location.href}.`};
   if(condition.settled&&Date.now()-last>500)return{ok:true,detail:'The page settled.'};
   await new Promise(r=>setTimeout(r,100));
  }
  return{ok:false,detail:'Waited, but it did not happen.'};
 }finally{observer.disconnect();}
}
export {idOf};
