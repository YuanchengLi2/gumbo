import {factsGuard} from './suggestion';
import {partialJson} from './partial-json';
/** Tab for actions: what the user is about to do on a page, as far ahead as Gumbo is sure, as steps on the page's own
 * elements (by the ids the page model gave them): typing into fields, choosing options, clicking, pressing a key, opening
 * a page. The model proposes it; this checks it before anything is shown: every element must be on the page, and text it
 * would type may hold no number, address, name or date that is not on the page, in the user's profile or memory, or in
 * what they did; the plan keeps the steps up to the first one that fails. */
export type PlanStep={do:'click'|'type'|'select'|'key'|'open';id?:string;text?:string;option?:string;combo?:string;url?:string};
/** more: finishing it takes steps that are not on the page yet (they appear after these): Gumbo's agent carries on. */
export type Plan={label:string;confidence:number;steps:PlanStep[];more?:boolean};
export const MAX_STEPS=8;

export function planOf(reply:string,ids:Set<string>,known:string):Plan|null{
 const json=/\{[\s\S]*\}/.exec(reply)?.[0];if(!json)return null;
 let raw:any;try{raw=JSON.parse(json);}catch{return null;}
 return planFrom(raw,ids,known);
}
/** The plan as far as the reply has streamed: only steps whose object has closed, and only once the confidence and the
 * label have arrived (the model writes them first). A one-step plan shows the moment its step is whole. */
export function partialPlan(reply:string,ids:Set<string>,known:string):Plan|null{
 const start=reply.indexOf('{');if(start<0)return null;
 const raw=partialJson(reply.slice(start)) as any;
 if(!raw||typeof raw.confidence!=='number'||typeof raw.label!=='string'||!Array.isArray(raw.steps))return null;
 const whole=closedSteps(reply.slice(start));if(!whole)return null;
 return planFrom({...raw,steps:raw.steps.slice(0,whole),more:undefined},ids,known);
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
function planFrom(raw:any,ids:Set<string>,known:string):Plan|null{
 const steps:PlanStep[]=[];
 for(const s of Array.isArray(raw?.steps)?raw.steps.slice(0,MAX_STEPS):[]){
  const step=checked(s,ids,known);if(!step)break;steps.push(step);
 }
 if(!steps.length)return null;
 const confidence=Math.max(0,Math.min(1,Number(raw.confidence)||0));
 return{label:String(raw.label??'').trim().slice(0,60)||labelOf(steps[0]),confidence,steps,...(raw.more===true?{more:true}:{})};
}
function checked(s:any,ids:Set<string>,known:string):PlanStep|null{
 if(!s||typeof s!=='object')return null;
 const id=typeof s.id==='string'?s.id:undefined;
 switch(s.do){
  case 'click':return id&&ids.has(id)?{do:'click',id}:null;
  case 'select':return id&&ids.has(id)&&s.option?{do:'select',id,option:String(s.option).slice(0,200)}:null;
  case 'key':return id&&ids.has(id)&&typeof s.combo==='string'&&/^((ctrl|control|shift|alt|meta|cmd)\+)*(enter|escape|tab|space|arrow(up|down|left|right)|[a-z0-9])$/i.test(s.combo)?{do:'key',id,combo:s.combo}:null;
  case 'open':return typeof s.url==='string'&&/^https?:\/\//.test(s.url)?{do:'open',url:s.url}:null;
  case 'type':{
   if(!id||!ids.has(id)||typeof s.text!=='string'||!s.text)return null;
   const text=s.text.slice(0,2000);
   // A fact nobody gave (a number, an address, a name) is never typed.
   return factsGuard(text,known)===text?{do:'type',id,text}:null;
  }
 }
 return null;
}
export const labelOf=(s:PlanStep)=>s.do==='type'?`Type “${(s.text??'').slice(0,30)}”`:s.do==='select'?`Choose “${s.option}”`:s.do==='open'?`Open ${new URL(s.url!).hostname}`:s.do==='key'?`Press ${s.combo}`:'Click';
/** The same suggestion, however it is worded: its first step. */
export const stepKey=(s:PlanStep|undefined)=>s?`${s.do}:${s.id??s.url??''}:${(s.text??s.option??s.combo??'').slice(0,40).toLowerCase()}`:'';
