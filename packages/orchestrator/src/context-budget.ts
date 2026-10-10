import type {ProjectDB} from '@dream/project-db';
import {engineBudgets} from '@dream/config';
import {providerView,conversationBytes} from './conversation';
/** Conservative planning estimate; near-limit requests require provider counting. */
export function estimateTokens(value:any):number{
 if(value?.type==='image')return 1600;
 if(typeof value==='string')return Math.ceil(Buffer.byteLength(value,'utf8')/3);
 if(Array.isArray(value))return value.reduce((n,v)=>n+estimateTokens(v),0);
 if(value&&typeof value==='object')return Object.entries(value).reduce((n,[k,v])=>n+Math.ceil(k.length/3)+estimateTokens(v),0);
 return 1;
}
export const contextTarget=(model:string,purpose:string)=>purpose==='routing'?engineBudgets.routerInput:model.startsWith('claude-haiku')?engineBudgets.haikuInput:engineBudgets.workingInput;
/** Builds the provider view. Compaction happens only when a measured count exceeds the target (compactRatio < 1). */
export function budgetRequest(db:ProjectDB,input:{model:string;purpose:string;system:string;messages:any[];tools:unknown[];turnId?:string;max_tokens:number;phase?:string},compactRatio?:number){
 const target=contextTarget(input.model,input.purpose);
 // Working targets control cost, not whether a task may continue. Only the
 // provider's real context window (including output) is a hard boundary.
 const limit=(input.model.endsWith('5-5')?1_000_000:200_000)-input.max_tokens-8192;
 const scope=`${input.purpose}:${input.model}:${input.phase??'main'}`,turn=input.turnId??'standalone';
 let messages=providerView(db,turn,scope,input.messages);
 if(compactRatio!==undefined)messages=providerView(db,turn,scope,input.messages,Math.floor(conversationBytes(messages)*compactRatio));
 const estimated=estimateTokens({system:input.system,messages,tools:input.tools});
 return{messages,estimated,limit,target,outputReserve:input.max_tokens,needsCount:estimated>target*.8};
}
