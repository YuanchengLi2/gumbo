import {useEffect,useState} from 'react';
import {modelCatalog,modelInfo,type ModelChoice,type Provider} from '@dream/config';

/** Roux 1 is Gumbo's own model, what users see for Auto: DeepSeek V4.1 Flash does the editing and Haiku the work in the
 * background (packages/config autoModels). It is the default and the recommended pick; every other model is a premium
 * choice. The models Roux 1 runs on (Haiku, DeepSeek) and GPT-6 Luna are not offered on their own. */
export const ROUX='Roux 1';
export const hiddenChoices:readonly ModelChoice[]=['haiku','gpt-luna','deepseek-flash'];
export const pickable=modelCatalog.filter(m=>!hiddenChoices.includes(m.choice));
/** The composer's model list: Roux 1, then each provider's models. Claude always runs; the others run once their key is on
 * the gateway, which the app asks about once per session (and again when a project opens). */
export const choices:ModelChoice[]=['auto',...pickable.map(m=>m.choice)];
export const shortLabel=(choice:ModelChoice)=>choice==='auto'?ROUX:(modelInfo(choice)?.label??choice).replace(/^Claude /,'');
/** A model id as a short name, for cost rows ("Sonnet 5.5", "GPT-6.1 Sol"). */
export const modelName=(id:string)=>(modelInfo(id)?.label??id).replace(/^Claude /,'');
let known:Partial<Record<Provider,boolean>>={anthropic:true};const listeners=new Set<()=>void>();
export const providersKnown=()=>known;
export async function refreshProviders(){
 try{const value=await window.dream.command({type:'ai_providers'}) as Partial<Record<Provider,boolean>>|undefined;if(value&&typeof value==='object'){known={...value,anthropic:true};listeners.forEach(l=>l());}}catch{}
}
export function useProviders(projectId?:string){
 const [value,setValue]=useState(known);
 useEffect(()=>{const update=()=>setValue(known);listeners.add(update);void refreshProviders();return()=>{listeners.delete(update);};},[projectId]);
 return value;
}
export const available=(choice:ModelChoice,providers=known)=>choice==='auto'||!!providers[modelInfo(choice)?.provider??'anthropic'];
