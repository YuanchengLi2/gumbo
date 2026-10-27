import {factsGuard} from './suggestion';
import {partialJson} from './partial-json';
/** Tab for actions: the user's next move on a page, as Cursor's Tab is the next edit. A move is one thing a person does
 * in a browser (click, double-click, right-click, point at something to open it, drag something somewhere, choose an
 * option, press a key, scroll to something, go back, open a page) or filling in fields (the ones of the form they are
 * in). With it comes "then": the move most likely right after it, shown the moment this one is done, so Tab, Tab, Tab
 * goes as fast as the person does, one visible move at a time. The model proposes it; this checks it before anything is
 * shown: every element must be on the page (the next move may name one that is not there yet), and text it would type
 * may hold no number, address, name or date that is not on the page, in the user's profile or memory, or in what they
 * did. */
export type PlanStep={do:'click'|'double_click'|'right_click'|'hover'|'drag'|'type'|'select'|'key'|'scroll'|'back'|'open';
 id?:string;text?:string;option?:string;combo?:string;url?:string;
 /** A drag's drop: onto an element, or by so many pixels. */to?:string;by?:[number,number];
 /** The next move's element when it is not on the page yet, by what it is. */role?:string;name?:string};
export type Plan={label:string;confidence:number;steps:PlanStep[];then?:PlanStep};
export const MAX_FILLS=8;
const fills=new Set(['type','select']);

export function planOf(reply:string,ids:Set<string>,known:string):Plan|null{
 const json=/\{[\s\S]*\}/.exec(reply)?.[0];if(!json)return null;
 let raw:any;try{raw=JSON.parse(json);}catch{return null;}
 return planFrom(raw,ids,known);
}
/** The plan as far as the reply has streamed: only steps whose object has closed, and only once the confidence and the
 * label have arrived (the model writes them first). A move shows the moment its step is whole. */
export function partialPlan(reply:string,ids:Set<string>,known:string):Plan|null{
 const start=reply.indexOf('{');if(start<0)return null;
 const raw=partialJson(reply.slice(start)) as any;
 if(!raw||typeof raw.confidence!=='number'||typeof raw.label!=='string'||!Array.isArray(raw.steps))return null;
 const whole=closedSteps(reply.slice(start));if(!whole)return null;
 return planFrom({...raw,steps:raw.steps.slice(0,whole),then:undefined},ids,known);
}
/** How many objects in the "steps" array have closed so far. */
function closedSteps(text:string){
 const at=text.search(/"steps"\s*:\s*\[/);if(at<0)return 0;
 let depth=0,count=0,inString=false,escaped=false;
 for(let i=text.indexOf('[',at)+1;i<text.length;i++){
  const c=text[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)count++;}else if(c===']'&&depth===0)break;
 }
 return count;
}
/** One move: a single action, or fields filled in one after another (and nothing after them: what comes next is the
 * next move). */
function planFrom(raw:any,ids:Set<string>,known:string):Plan|null{
 const steps:PlanStep[]=[];
 for(const s of Array.isArray(raw?.steps)?raw.steps.slice(0,MAX_FILLS):[]){
  const step=checked(s,ids,known);if(!step)break;
  if(steps.length&&!(fills.has(step.do)&&fills.has(steps[0].do)))break;
  steps.push(step);if(!fills.has(step.do))break;
 }
 if(!steps.length)return null;
 const confidence=Math.max(0,Math.min(1,Number(raw.confidence)||0));
 const then=raw?.then&&typeof raw.then==='object'?checked(raw.then,ids,known,true):null;
 return{label:String(raw.label??'').trim().slice(0,60)||labelOf(steps[0]),confidence,steps,...(then?{then}:{})};
}
/** A step, checked; the next move ("ahead") may name its element (role and name) instead, as it may not exist yet. */
function checked(s:any,ids:Set<string>,known:string,ahead=false):PlanStep|null{
 if(!s||typeof s!=='object')return null;
 const id=typeof s.id==='string'&&ids.has(s.id)?s.id:undefined;
 const named=ahead&&!id&&typeof s.name==='string'&&s.name.trim()?{name:s.name.trim().slice(0,80),...(typeof s.role==='string'?{role:s.role.slice(0,30)}:{})}:undefined;
 const on=id?{id}:named;
 switch(s.do){
  case 'click':case 'double_click':case 'right_click':case 'hover':return on?{do:s.do,...on}:null;
  case 'select':return on&&s.option?{do:'select',...on,option:String(s.option).slice(0,200)}:null;
  case 'key':return (on||!s.id)&&typeof s.combo==='string'&&/^((ctrl|control|shift|alt|meta|cmd)\+)*(enter|escape|tab|space|backspace|delete|arrow(up|down|left|right)|page(up|down)|home|end|[a-z0-9])$/i.test(s.combo)?{do:'key',...(on??{}),combo:s.combo}:null;
  case 'scroll':return on?{do:'scroll',...on}:null;
  case 'back':return{do:'back'};
  case 'open':return typeof s.url==='string'&&/^https?:\/\//.test(s.url)?{do:'open',url:s.url}:null;
  case 'drag':{
   if(!on)return null;
   const to=typeof s.to==='string'&&ids.has(s.to)?s.to:undefined,by=Array.isArray(s.by)&&s.by.length===2&&s.by.every((n:unknown)=>Number.isFinite(Number(n)))?[Number(s.by[0]),Number(s.by[1])] as [number,number]:undefined;
   return to||by?{do:'drag',...on,...(to?{to}:{by})}:null;
  }
  case 'type':{
   if(!on||typeof s.text!=='string'||!s.text)return null;
   const text=s.text.slice(0,2000);
   // A fact nobody gave (a number, an address, a name) is never typed.
   return factsGuard(text,known)===text?{do:'type',...on,text}:null;
  }
 }
 return null;
}
export const labelOf=(s:PlanStep)=>s.do==='type'?`Type “${(s.text??'').slice(0,30)}”`:s.do==='select'?`Choose “${s.option}”`:s.do==='open'?`Open ${new URL(s.url!).hostname}`:s.do==='key'?`Press ${s.combo}`:s.do==='drag'?'Drag it':s.do==='back'?'Go back':s.do==='scroll'?'Scroll to it':s.do==='hover'?'Open it':s.do==='double_click'?'Double-click':s.do==='right_click'?'Right-click':`Click${s.name?` “${s.name.slice(0,30)}”`:''}`;
/** The same suggestion, however it is worded: its first step. */
export const stepKey=(s:PlanStep|undefined)=>s?`${s.do}:${s.id??s.name??s.url??''}:${(s.text??s.option??s.combo??s.to??'').slice(0,40).toLowerCase()}`:'';
