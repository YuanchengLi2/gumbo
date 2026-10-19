import {useEffect,useRef} from 'react';
import type {ProjectState} from '@dream/project-db';
import {accountNow,refreshAccount} from './account';

/** Helping improve Gumbo's AI: asked in the onboarding, changed in Settings > Privacy (settings.json's improve). For the
 * owner's account always, and for anyone who said yes, every finished edit sends its whole log as training data: the
 * request, every step and note, the code the agent wrote, costs, and the rating if one was given. Never footage. These
 * are the examples a fine-tuned Roux will learn from; an edit that went wrong says why in its note. */
export const CREDITS_TO_REPORT=60,CALLS_TO_REPORT=50;
const SENT='gumbo-training-sent';
const sent=():string[]=>{try{return JSON.parse(localStorage.getItem(SENT)??'[]');}catch{return [];}};
const remember=(turnId:string)=>{try{localStorage.setItem(SENT,JSON.stringify([...sent().slice(-499),turnId]));}catch{}};

/** Why a finished edit counts as having gone wrong, or undefined. */
export function reportReason(o:{credits:number;calls:number;ending:string}){
 if(/^Stopped\b/i.test(o.ending))return 'the edit was stopped';
 if(/^Paused after about \d+ credits/i.test(o.ending))return 'the edit hit the credits pause';
 if(/could not|failed|repeated attempts|blocked/i.test(o.ending.slice(0,200)))return 'the edit ended with a problem';
 if(o.credits>=CREDITS_TO_REPORT)return `the edit cost ${Math.round(o.credits)} credits`;
 if(o.calls>=CALLS_TO_REPORT)return `the edit took ${o.calls} steps`;
 return undefined;
}

/** Whether this computer shares edits: the owner's account always, anyone else only after saying yes. */
export async function sharesEdits(){
 const account=accountNow()??await refreshAccount().catch(()=>undefined);if(!account?.signedIn)return false;if(account.admin)return true;
 const settings=await window.dream.settings().catch(()=>null) as {improve?:boolean}|null;return !!settings?.improve;
}
const upload=(turnId:string,kind:'training'|'feedback',note:string,rating?:'up'|'down')=>window.dream.command({type:'account',action:'report',turnId,kind,note,...(rating?{rating}:{})}).catch(()=>{});

/** A rating: kept with the project, and sent with the edit's log when this computer shares edits. */
export async function rateEdit(turnId:string,rating:'up'|'down'|null){
 await window.dream.command({type:'turn_feedback',turnId,rating}).catch(()=>{});
 if(rating&&await sharesEdits())await upload(turnId,'feedback',rating==='up'?'Rated good.':'Rated bad.',rating);
}

/** Watches the project's edits; when one finishes, sends its log once as training data if this computer shares edits. */
export function useEditCollection(project:ProjectState){
 const turnId=project.experience?.turnId,running=project.aiStatus==='running',was=useRef<{turnId?:string;running:boolean}>({turnId,running});
 useEffect(()=>{
  const before=was.current;was.current={turnId,running};
  if(!before.running||running||!before.turnId||before.turnId!==turnId)return;
  const finished=before.turnId;if(sent().includes(finished))return;
  void (async()=>{
   if(!await sharesEdits())return;
   const usage=await window.dream.command<any>({type:'turn_usage',turnId:finished}).catch(()=>null);
   const rows:any[]=usage?.rows??[],credits=rows.reduce((n,r)=>n+Number(r.cost??0),0)*100,calls=rows.reduce((n,r)=>n+Number(r.calls??0),0);
   const ending=[...project.messages].reverse().find(m=>m.turnId===finished&&m.role==='assistant')?.text??'';
   const reason=reportReason({credits,calls,ending:String(ending)});
   remember(finished);
   await upload(finished,'training',reason?`Went wrong: ${reason}.`:'Finished.');
  })();
 },[turnId,running]);
}
