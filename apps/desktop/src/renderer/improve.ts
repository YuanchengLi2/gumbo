import {useEffect,useRef} from 'react';
import type {ProjectState} from '@dream/project-db';

/** Helping improve Gumbo: asked in the onboarding, changed in Settings > Privacy (settings.json's improve). When it is on,
 * an edit that went wrong sends its log by itself, the same log as Send log (the steps, the request, the code the agent
 * wrote, never footage), so the problems people hit reach us without anyone having to report them. Most never would. */
export const CREDITS_TO_REPORT=60,CALLS_TO_REPORT=50;
const SENT='gumbo-auto-reported';
const sent=():string[]=>{try{return JSON.parse(localStorage.getItem(SENT)??'[]');}catch{return [];}};
const remember=(turnId:string)=>{try{localStorage.setItem(SENT,JSON.stringify([...sent().slice(-199),turnId]));}catch{}};

/** Why a finished edit counts as having gone wrong, or undefined. */
export function reportReason(o:{credits:number;calls:number;ending:string}){
 if(/^Stopped\b/i.test(o.ending))return 'the edit was stopped';
 if(/^Paused after about \d+ credits/i.test(o.ending))return 'the edit hit the credits pause';
 if(/could not|failed|repeated attempts|blocked/i.test(o.ending.slice(0,200)))return 'the edit ended with a problem';
 if(o.credits>=CREDITS_TO_REPORT)return `the edit cost ${Math.round(o.credits)} credits`;
 if(o.calls>=CALLS_TO_REPORT)return `the edit took ${o.calls} steps`;
 return undefined;
}

/** Watches the project's edits; when one finishes and went wrong, sends its log once if helping improve is on. */
export function useAutoReport(project:ProjectState){
 const turnId=project.experience?.turnId,running=project.aiStatus==='running',was=useRef<{turnId?:string;running:boolean}>({turnId,running});
 useEffect(()=>{
  const before=was.current;was.current={turnId,running};
  if(!before.running||running||!before.turnId||before.turnId!==turnId)return;
  const finished=before.turnId;if(sent().includes(finished))return;
  void (async()=>{
   const settings=await window.dream.settings().catch(()=>null) as {improve?:boolean}|null;if(!settings?.improve)return;
   const usage=await window.dream.command<any>({type:'turn_usage',turnId:finished}).catch(()=>null);
   const rows:any[]=usage?.rows??[],credits=rows.reduce((n,r)=>n+Number(r.cost??0),0)*100,calls=rows.reduce((n,r)=>n+Number(r.calls??0),0);
   const ending=[...project.messages].reverse().find(m=>m.turnId===finished&&m.role==='assistant')?.text??'';
   const reason=reportReason({credits,calls,ending:String(ending)});if(!reason)return;
   remember(finished);
   await window.dream.command({type:'account',action:'report',turnId:finished,note:`Sent automatically because ${reason}.`}).catch(()=>{});
  })();
 },[turnId,running]);
}
