import {providerModels,providerCost} from './providers.ts';
/** Low-cost defaults with a bounded, purpose-specific escalation path. */
export function validProfile(value:any){return value===undefined||value&&value.version===1&&['router','editor','executor','planner','consultation','review'].includes(value.role)&&['low','medium','high','xhigh'].includes(value.effort)&&['simple','normal','difficult'].includes(value.complexity)&&typeof value.reason==='string'&&value.reason.length<=500;}
/** Optional client hints. A task budget lets the model pace a long agent loop; ignored when absent or turned off. */
export type PolicyOptions={taskBudget?:{total:number;remaining?:number}};
export function validTaskBudget(value:any){return value===undefined||!!value&&Number.isInteger(value.total)&&value.total>=20_000&&value.total<=1_000_000&&(value.remaining===undefined||Number.isInteger(value.remaining)&&value.remaining>=0&&value.remaining<=value.total);}
export const TASK_BUDGET_BETA='task-budgets-2026-03-13';
export function inferencePolicy(model:string,purpose:unknown='routine',profile?:{effort:string},options:PolicyOptions={}){
 const effort=profile?.effort??(purpose==='consultation'?'medium':'low');
 const budget=options.taskBudget?{task_budget:{type:'tokens',total:options.taskBudget.total,...(options.taskBudget.remaining!==undefined?{remaining:options.taskBudget.remaining}:{})}}:{};
 // Triage answers with what the request is, how hard (1-5), whether it needs eyes on the footage, and its parts; the older
 // router (a model id) and parts calls keep their schemas for app versions that still send them.
 const format=purpose==='triage'?{format:{type:'json_schema',schema:{type:'object',properties:{kind:{type:'string',enum:['edit','answer','plan','continue']},difficulty:{type:'integer'},work:{type:'string',enum:['talk','look','write','fix','footage','graphics','sound','restructure']},feedback:{type:'string',enum:['positive','negative','none']},model:{type:'string'},vision:{type:'boolean'},carriesStopped:{type:'boolean'},parts:{type:'array',items:{type:'string'}},lookFor:{type:'string'},reason:{type:'string'}},required:['kind','difficulty','work','feedback','model','vision','carriesStopped','parts','lookFor','reason'],additionalProperties:false}}}:purpose==='request_parts'?{format:{type:'json_schema',schema:{type:'object',properties:{parts:{type:'array',items:{type:'string'}}},required:['parts'],additionalProperties:false}}}:purpose==='model_routing'?{format:{type:'json_schema',schema:{type:'object',properties:{model:{type:'string'},reason:{type:'string'}},required:['model','reason'],additionalProperties:false}}}:purpose==='routing'?{format:{type:'json_schema',schema:{type:'object',properties:{route:{type:'string',enum:['local','question','plan','continue']},intelligence:{type:'string',enum:['haiku','sonnet','opus']},complexity:{type:'string',enum:['simple','normal','difficult']},reason:{type:'string'},projectTitle:{type:'string'},approvalQuote:{type:['string','null']}},required:['route','intelligence','complexity','reason','approvalQuote','projectTitle'],additionalProperties:false}}}:{};
 // Haiku's summarized thinking costs the same as omitted; the app shows it as transient progress on the worker's row.
 if(model==='claude-haiku-5-5')return{thinking:{type:'adaptive',display:'summarized',block_binding:{prefix_mismatch_behavior:'drop_block'}},output_config:{effort,...format,...budget}};
 if(model==='claude-sonnet-5-5'||model==='claude-opus-5-5')return{thinking:{type:'adaptive',display:'updates',block_binding:{prefix_mismatch_behavior:'drop_block'}},output_config:{effort,...format,...budget}};
 return{};
}
/** Tools, system and the conversation are cached for five minutes, which covers the calls of a request (seconds apart);
 * a one-hour write costs twice the input price, against 1.25 times for five minutes, so the first call of every request
 * paid 60% more to keep a prefix that few next requests arrived in time to read. conversationTtl '1h' is for an editing
 * agent that waits many minutes on its helpers: every breakpoint is then one hour. */
export function cachedPrompt(system:unknown,tools:unknown,conversationTtl?:unknown){
 const cache=conversationTtl==='1h'?{type:'ephemeral',ttl:'1h'}:{type:'ephemeral'};
 return{system:typeof system==='string'?[{type:'text',text:system,cache_control:cache}]:system,tools:Array.isArray(tools)?tools.map((tool,n)=>n===tools.length-1?{...tool,cache_control:cache}:tool):tools,cache_control:cache};
}
// Prices for models that can serve a server-side refusal fallback; billed per attempt from usage.iterations.
const attemptPrices:Record<string,[number,number]>={'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-opus-5':[5,25],'claude-opus-4-8':[5,25],'claude-sonnet-5':[2,10],'claude-sonnet-4-6':[3,15]};
export function usageCost(model:string,usage:Record<string,any>,price:[number,number],at=new Date()):number{
 // Other providers' models: uncached input, cache reads at that model's own rate, and output; no cache writes; at the
 // rates that apply at that moment and for that prompt size.
 if(providerModels[model])return providerCost(providerModels[model],usage,at);
 if(Array.isArray(usage.iterations)&&usage.iterations.some((entry:any)=>entry?.type==='fallback_message'))return usage.iterations.reduce((sum:number,entry:any)=>{const served=typeof entry?.model==='string'?entry.model:model;return sum+usageCost(served,{...entry,iterations:undefined},attemptPrices[served]??price);},0);
 if(model==='claude-haiku-5-5')price=(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)+(usage.cache_creation_input_tokens??0)>100000?[.5,2.5]:[.1,.5];
 // Cache reads: Opus 5.5 $0.20 on $4 input; Sonnet 5.5 $0.20 on $2 input.
 const readMultiplier=model==='claude-opus-5-5'?.05:.1;
 const written=usage.cache_creation_input_tokens??0,hour=Math.min(written,Number(usage.cache_creation?.ephemeral_1h_input_tokens??0));
 return((usage.input_tokens??0)*price[0]+(usage.output_tokens??0)*price[1]+(usage.cache_read_input_tokens??0)*price[0]*readMultiplier+(written-hour)*price[0]*1.25+hour*price[0]*2)/1e6+Number(usage.server_tool_use?.web_search_requests??0)*.01;
}
export function promptEstimate(value:any):number{if(value?.type==='image')return 1600;if(value?.type==='audio')return Math.ceil((Number(value.durationSec)||90)*32)+50;if(typeof value==='string')return Math.ceil(new TextEncoder().encode(value).length/3);if(Array.isArray(value))return value.reduce((n,v)=>n+promptEstimate(v),0);if(value&&typeof value==='object')return Object.entries(value).reduce((n,[k,v])=>n+Math.ceil(k.length/3)+promptEstimate(v),0);return 1;}

export const providerHeaders=(key:string,extraBetas:string[]=[])=>({'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json','anthropic-beta':['thinking-binding-controls-2026-08-01','thinking-display-updates-2026-08-18',...extraBetas].join(',')});
/** Server-side refusal fallback re-runs a policy decline on Anthropic's recommended model. Not available for Haiku 5.5. */
export const FALLBACK_BETA='server-side-fallback-2026-07-01';
export const refusalFallback=(model:string)=>model==='claude-opus-5-5'||model==='claude-sonnet-5-5';

export const pricingVersion='anthropic-2026-10-07';
/** Optional features this deployment understands; the app reads them from dream_policy.features. */
export const gatewayFeatures=(taskBudgets:boolean)=>['cache-ttl-1h','summarized-thinking','cost-receipts',...(taskBudgets?['task-budgets']:[])];
