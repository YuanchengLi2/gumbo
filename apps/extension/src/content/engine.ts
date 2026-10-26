/// <reference types="chrome" />
import {fieldOf,type Field} from './fields/field';
import {snapshot} from './fields/text';
import {caretOf} from './fields/caret';
import {insert} from './fields/insert';
import {readContext} from './context';
import {showGhost,hideGhost} from './ui/ghost';
import {layer} from './ui/root';
import {pageModel} from './perceive';
import {perform,irreversible,findTarget,type Action} from './act';
import {deepActive} from './dom';
import {startTab,tabState} from './tab';
import {startInline} from './inline';
import {startCapture} from './capture';

/** Gumbo in one frame (or one of the extension's own pages): tracks the field in focus, runs Tab, Ctrl+K and capture,
 * and answers the engine's requests (the page model, an action, and checks the tests use). */
let started=false;
export let focused:Field|null=null;
export function start(_window:Window){
 if(started)return;started=true;
 const track=()=>{focused=fieldOf(deepActive());};
 document.addEventListener('focusin',track,true);document.addEventListener('focusout',()=>setTimeout(track,0),true);track();
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  const answer=handle(message);if(answer===undefined)return;
  answer.then(reply,error=>reply({ok:false,detail:(error as Error).message}));return true;
 });
 startTab();startInline();startCapture();
}
/** Requests from the engine. A request about the field in focus is answered only by the frame that has it, so the
 * reply comes from the right frame of a page with many. */
function handle(message:any):Promise<unknown>|undefined{
 const top=window===window.top,mine=!!focused&&document.hasFocus();
 switch(message?.type){
  case 'page.model':return top?Promise.resolve(pageModel()):undefined;
  case 'act':{
   if(!top&&!message.anyFrame)return;
   const action=message.action as Action,target='target' in action&&action.target?findTarget(action.target):null;
   if(irreversible(action,target)&&!message.confirmed)return Promise.resolve({ok:false,irreversible:true,detail:'This step is final; it waits for Enter.'});
   return perform(action);
  }
  case 'debug.field':{
   if(!mine)return;const field=focused!,snap=snapshot(field),caret=caretOf(field);
   return Promise.resolve({editor:field.editor,kind:field.kind,singleLine:field.singleLine,before:snap?.before,after:snap?.after,text:snap?.text,caret,context:readContext(field)});
  }
  case 'debug.ghost':{
   if(!mine)return;layer();const field=focused!,caret=caretOf(field),snap=snapshot(field);if(!caret||!snap)return Promise.resolve({ok:false});
   const atLineEnd=!snap.after||snap.after.startsWith('\n');
   return Promise.resolve({ok:true,...showGhost(caret,message.text,{atLineEnd,singleLine:field.singleLine,ownWrapping:field.kind==='context'})});
  }
  case 'debug.hide':hideGhost();return Promise.resolve({ok:true});
  case 'debug.tab':return mine?Promise.resolve(tabState()):undefined;
  case 'debug.insert':{if(!mine)return;hideGhost();return insert(focused!,message.text);}
 }
 return undefined;
}
