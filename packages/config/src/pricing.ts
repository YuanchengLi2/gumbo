// Client-side mirror of the gateway's billing formula (supabase/functions/dream-gateway/inference-policy.ts usageCost),
// so the app can show what each call cost. A parity test keeps the two identical.
export const modelPrices:Record<string,[number,number]>={'claude-haiku-5-5':[.1,.5],'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-haiku-4-5-20251001':[1,5]};
const attemptPrices:Record<string,[number,number]>={'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-opus-5':[5,25],'claude-opus-4-8':[5,25],'claude-sonnet-5':[2,10],'claude-sonnet-4-6':[3,15]};
/** Haiku 5.5 prompts above this many input tokens (including cache reads and writes) are billed at the long-context rate. */
export const HAIKU_LONG_CONTEXT=100_000;
export function usageCost(model:string,usage:Record<string,any>,price:[number,number]=modelPrices[model]??[0,0]):number{
 if(Array.isArray(usage.iterations)&&usage.iterations.some((entry:any)=>entry?.type==='fallback_message'))return usage.iterations.reduce((sum:number,entry:any)=>{const served=typeof entry?.model==='string'?entry.model:model;return sum+usageCost(served,{...entry,iterations:undefined},attemptPrices[served]??price);},0);
 if(model==='claude-haiku-5-5')price=(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)+(usage.cache_creation_input_tokens??0)>HAIKU_LONG_CONTEXT?[.5,2.5]:[.1,.5];
 const readMultiplier=model==='claude-opus-5-5'?.05:.1;
 const written=usage.cache_creation_input_tokens??0,hour=Math.min(written,Number(usage.cache_creation?.ephemeral_1h_input_tokens??0));
 return((usage.input_tokens??0)*price[0]+(usage.output_tokens??0)*price[1]+(usage.cache_read_input_tokens??0)*price[0]*readMultiplier+(written-hour)*price[0]*1.25+hour*price[0]*2)/1e6+Number(usage.server_tool_use?.web_search_requests??0)*.01;
}
/** Total prompt tokens of a response, whether read from cache, written to it or uncached. */
export const promptTokens=(usage:any)=>(usage?.input_tokens??0)+(usage?.cache_read_input_tokens??0)+(usage?.cache_creation_input_tokens??0);
