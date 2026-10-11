/** Low-cost defaults with a bounded, purpose-specific escalation path. */
export function validProfile(value:any){return value===undefined||value&&value.version===1&&['router','editor','executor','planner','consultation','review'].includes(value.role)&&['low','medium','high'].includes(value.effort)&&['simple','normal','difficult'].includes(value.complexity)&&typeof value.reason==='string'&&value.reason.length<=500;}
/** Optional client hints. A task budget lets the model pace a long agent loop; ignored when absent or turned off. */
export type PolicyOptions={taskBudget?:{total:number;remaining?:number}};
export function validTaskBudget(value:any){return value===undefined||!!value&&Number.isInteger(value.total)&&value.total>=20_000&&value.total<=1_000_000&&(value.remaining===undefined||Number.isInteger(value.remaining)&&value.remaining>=0&&value.remaining<=value.total);}
export const TASK_BUDGET_BETA='task-budgets-2026-03-13';
export function inferencePolicy(model:string,purpose:unknown='routine',profile?:{effort:string},options:PolicyOptions={}){
 const effort=profile?.effort??(purpose==='consultation'?'medium':'low');
 const budget=options.taskBudget?{task_budget:{type:'tokens',total:options.taskBudget.total,...(options.taskBudget.remaining!==undefined?{remaining:options.taskBudget.remaining}:{})}}:{};
 const format=purpose==='routing'?{format:{type:'json_schema',schema:{type:'object',properties:{route:{type:'string',enum:['local','question','plan','continue']},intelligence:{type:'string',enum:['haiku','sonnet','opus']},complexity:{type:'string',enum:['simple','normal','difficult']},reason:{type:'string'},projectTitle:{type:'string'},approvalQuote:{type:['string','null']}},required:['route','intelligence','complexity','reason','approvalQuote','projectTitle'],additionalProperties:false}}}:{};
 // Haiku's summarized thinking costs the same as omitted; the app shows it as transient progress on the worker's row.
 if(model==='claude-haiku-5-5')return{thinking:{type:'adaptive',display:'summarized',block_binding:{prefix_mismatch_behavior:'drop_block'}},output_config:{effort,...format,...budget}};
 if(model==='claude-sonnet-5-5'||model==='claude-opus-5-5')return{thinking:{type:'adaptive',display:'updates',block_binding:{prefix_mismatch_behavior:'drop_block'}},output_config:{effort,...budget}};
 return{};
}
/** Tools and system are identical across every request of a role, so they keep a one-hour cache between user requests.
 * The conversation itself uses automatic five-minute caching at its last block (longer TTLs must precede shorter ones).
 * conversationTtl '1h' is for a lead that waits many minutes on workers: every breakpoint is then one hour. */
export function cachedPrompt(system:unknown,tools:unknown,conversationTtl?:unknown){
 const longLived={type:'ephemeral',ttl:'1h'};
 return{system:typeof system==='string'?[{type:'text',text:system,cache_control:longLived}]:system,tools:Array.isArray(tools)?tools.map((tool,n)=>n===tools.length-1?{...tool,cache_control:longLived}:tool):tools,cache_control:conversationTtl==='1h'?longLived:{type:'ephemeral'}};
}
// Prices for models that can serve a server-side refusal fallback; billed per attempt from usage.iterations.
const attemptPrices:Record<string,[number,number]>={'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-opus-5':[5,25],'claude-opus-4-8':[5,25],'claude-sonnet-5':[2,10],'claude-sonnet-4-6':[3,15]};
export function usageCost(model:string,usage:Record<string,any>,price:[number,number]):number{
 if(Array.isArray(usage.iterations)&&usage.iterations.some((entry:any)=>entry?.type==='fallback_message'))return usage.iterations.reduce((sum:number,entry:any)=>{const served=typeof entry?.model==='string'?entry.model:model;return sum+usageCost(served,{...entry,iterations:undefined},attemptPrices[served]??price);},0);
 if(model==='claude-haiku-5-5')price=(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)+(usage.cache_creation_input_tokens??0)>100000?[.5,2.5]:[.1,.5];
 // Cache reads: Opus 5.5 $0.20 on $4 input; Sonnet 5.5 $0.20 on $2 input.
 const readMultiplier=model==='claude-opus-5-5'?.05:.1;
 const written=usage.cache_creation_input_tokens??0,hour=Math.min(written,Number(usage.cache_creation?.ephemeral_1h_input_tokens??0));
 return((usage.input_tokens??0)*price[0]+(usage.output_tokens??0)*price[1]+(usage.cache_read_input_tokens??0)*price[0]*readMultiplier+(written-hour)*price[0]*1.25+hour*price[0]*2)/1e6;
}
export function promptEstimate(value:any):number{if(value?.type==='image')return 1600;if(typeof value==='string')return Math.ceil(new TextEncoder().encode(value).length/3);if(Array.isArray(value))return value.reduce((n,v)=>n+promptEstimate(v),0);if(value&&typeof value==='object')return Object.entries(value).reduce((n,[k,v])=>n+Math.ceil(k.length/3)+promptEstimate(v),0);return 1;}

export const providerHeaders=(key:string,extraBetas:string[]=[])=>({'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json','anthropic-beta':['thinking-binding-controls-2026-08-01','thinking-display-updates-2026-08-18',...extraBetas].join(',')});
/** Server-side refusal fallback re-runs a policy decline on Anthropic's recommended model. Not available for Haiku 5.5. */
export const FALLBACK_BETA='server-side-fallback-2026-07-01';
export const refusalFallback=(model:string)=>model==='claude-opus-5-5'||model==='claude-sonnet-5-5';

export const pricingVersion='anthropic-2026-10-07';
/** Optional features this deployment understands; the app reads them from dream_policy.features. */
export const gatewayFeatures=(taskBudgets:boolean)=>['cache-ttl-1h','summarized-thinking','cost-receipts',...(taskBudgets?['task-budgets']:[])];
