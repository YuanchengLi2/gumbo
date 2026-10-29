/// <reference types="chrome" />
import {alive} from './port';
/** The keys for what Tab offers (a suggestion, a move). Tab takes it, as in a code editor; holding Tab and pressing 1
 * goes to the next way it could go. Tab is Gumbo's only while something is offered: otherwise it is the page's, as
 * always. The surfaces themselves listen for one key each, Alt+Q to take and Alt and + (or −) to cycle, which is also
 * what Chrome hands Gumbo as a command (passed on to the frame with the focus, pressTake): the Tab key is turned into
 * those here, so every way in runs the same code. */
export const TAKE_KEY='Tab';
export const CYCLE_KEY='Tab+1';
export const takes=(event:KeyboardEvent)=>event.altKey&&event.code==='KeyQ'&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat;
/** 1 for the next of what Tab could offer here (another way to finish the sentence, another move), -1 for the one before;
 * 0 for any other key. */
export const cycles=(event:KeyboardEvent)=>!event.altKey||event.ctrlKey||event.metaKey||event.isComposing?0:event.code==='Equal'||event.code==='NumpadAdd'||event.key==='+'?1:event.code==='Minus'||event.code==='NumpadSubtract'?-1:0;
let lastTook=0;
/** Called when Gumbo used the press: it goes no further. */
export function took(event:KeyboardEvent){event.preventDefault();event.stopImmediatePropagation();lastTook=Date.now();}
function press(target:Element|null,init:KeyboardEventInit){
 const event=new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true,composed:true});
 (target??document.body).dispatchEvent(event);
 return event.defaultPrevented;
}
/** The command, pressed where the focus is. Ignored when the page itself just had the key (one press, never two). */
export function pressTake(target:Element|null):{used:boolean}{
 if(Date.now()-lastTook<400)return{used:true};
 return{used:press(target,{key:'q',code:'KeyQ',altKey:true})};
}
/** Whether something is offered now, from each surface by name (a ghost: "text", a move's chip: "move", a drawn
 * editor's words: "drawn"). */
const offering:{name:string;now:()=>boolean}[]=[];
export function offers(name:string,now:()=>boolean){offering.push({name,now});}
/** The surface whose offer was on screen when Tab went down: only it acts on the release (undefined: Alt+Q as Chrome's
 * command, where each surface checks for itself). What the user saw is what Tab does, whatever arrived in between. */
let taking:string|undefined;
export const mayTake=(name:string)=>taking===undefined||taking===name;
/** Tab, while something is offered: held, then let go, it takes it; held while 1 is pressed (as often as wanted), it goes
 * through the other ways instead, and letting go keeps the one shown (the next Tab takes it). Shift+Tab and Tab with
 * nothing offered are the page's. Installed before every surface, so it hears the key first. */
export function startKeys(){
 let held:Element|null|undefined,cycled=false,heldAt=0,owner:string|undefined;
 const plain=(e:KeyboardEvent)=>e.key==='Tab'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.isComposing;
 const stop=(e:KeyboardEvent)=>{e.preventDefault();e.stopImmediatePropagation();};
 window.addEventListener('keydown',e=>{
  if(!e.isTrusted||!alive())return;
  // A Tab whose release never reached this frame (the focus left mid-press) is not held any more.
  if(held!==undefined&&!e.repeat&&Date.now()-heldAt>3000)held=undefined;
  if(held!==undefined){
   if(plain(e)){stop(e);return;}
   if(e.code==='Digit1'||e.code==='Numpad1'){stop(e);cycled=true;press(held,{key:'=',code:'Equal',altKey:true});}
   // Any other key while Tab is down: they meant something else, so letting go takes nothing.
   else cycled=true;
   return;
  }
  if(!plain(e)||e.repeat)return;
  const shown=offering.find(o=>{try{return o.now();}catch{return false;}});if(!shown)return;
  stop(e);held=e.composedPath()[0] as Element|null;cycled=false;heldAt=Date.now();owner=shown.name;
 },true);
 window.addEventListener('keyup',e=>{
  if(held===undefined||e.key!=='Tab'||!alive())return;
  stop(e);const at=held;held=undefined;
  if(!cycled){lastTook=0;taking=owner;try{pressTake(at);}finally{taking=undefined;}}
 },true);
 window.addEventListener('blur',()=>{held=undefined;});
 document.addEventListener('visibilitychange',()=>{held=undefined;});
}
