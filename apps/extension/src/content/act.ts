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
 |{do:'type';target?:Target;text:string;replace?:boolean}
 |{do:'key';combo:string;target?:Target}
 |{do:'select';target:Target;option:string}
 |{do:'scroll';target?:Target;by:number}
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
  case 'scroll':{
   const el=action.target?findTarget(action.target):null;
   if(el)el.scrollBy({top:action.by,behavior:'instant' as ScrollBehavior});else window.scrollBy({top:action.by,behavior:'instant' as ScrollBehavior});
   return{ok:true,detail:`Scrolled ${action.by>0?'down':'up'}.`};
  }
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
async function watch(run:()=>void,ms=700,countFocus=true):Promise<boolean>{
 const url=location.href,focus=document.activeElement;let mutated=false;
 const observer=new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Element&&r.target.tagName==='GUMBO-LAYER')))mutated=true;});
 observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 try{run();}catch{}
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
