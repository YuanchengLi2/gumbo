import {modelCatalog,type ModelInfo} from './models';
// Client-side mirror of the gateway's billing formula (supabase/functions/dream-gateway/inference-policy.ts usageCost),
// so the app can show what each call cost. A parity test keeps the two identical.
export const modelPrices:Record<string,[number,number]>={'claude-haiku-5-5':[.1,.5],'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-haiku-4-5-20251001':[1,5]};
const attemptPrices:Record<string,[number,number]>={'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-opus-5':[5,25],'claude-opus-4-8':[5,25],'claude-sonnet-5':[2,10],'claude-sonnet-4-6':[3,15]};
/** Haiku 5.5 prompts above this many input tokens (including cache reads and writes) are billed at the long-context rate. */
export const HAIKU_LONG_CONTEXT=100_000;
/** DeepSeek's peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. */
const peak=(at:Date)=>{const day=at.getUTCDay(),hour=at.getUTCHours();return day>=1&&day<=5&&(hour>=1&&hour<4||hour>=6&&hour<10);};
/** What a call to another provider's model is billed at (the gateway's providerRates): a dated price change once it
 * applies, the long-context rate above its prompt size, the off-peak share outside peak hours. */
export function providerRates(model:ModelInfo,usage:Record<string,any>,at=new Date()){
 let rates:{price:[number,number];cachedRead:number}=model.change&&at>=new Date(model.change.from)?model.change:model;
 if(model.longContext&&(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)>model.longContext.above)rates=model.longContext;
 if(model.offPeak&&!peak(at))rates={price:[rates.price[0]*model.offPeak,rates.price[1]*model.offPeak],cachedRead:rates.cachedRead*model.offPeak};
 return rates;
}
/** Models only Gumbo for Chrome uses (not in the editor's menu), at their gateway prices. */
const extensionModels:{id:string;price:[number,number];cachedRead:number}[]=[{id:'groq-fast',price:[.59,.79],cachedRead:.59},{id:'gpt-6.1-terra',price:[1,5],cachedRead:.05}];
export function usageCost(model:string,usage:Record<string,any>,price:[number,number]=modelPrices[model]??[0,0],at=new Date()):number{
 // Other providers' models: uncached input, cache reads at that model's rate, and output (the gateway's providerCost).
 const other=modelCatalog.find(m=>m.id===model&&m.provider!=='anthropic')??extensionModels.find(m=>m.id===model) as ModelInfo|undefined;if(other){const rates=providerRates(other,usage,at);return((usage.input_tokens??0)*rates.price[0]+(usage.cache_read_input_tokens??0)*rates.cachedRead+(usage.output_tokens??0)*rates.price[1])/1e6;}
 if(Array.isArray(usage.iterations)&&usage.iterations.some((entry:any)=>entry?.type==='fallback_message'))return usage.iterations.reduce((sum:number,entry:any)=>{const served=typeof entry?.model==='string'?entry.model:model;return sum+usageCost(served,{...entry,iterations:undefined},attemptPrices[served]??price);},0);
 if(model==='claude-haiku-5-5')price=(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)+(usage.cache_creation_input_tokens??0)>HAIKU_LONG_CONTEXT?[.5,2.5]:[.1,.5];
 const readMultiplier=model==='claude-opus-5-5'?.05:.1;
 const written=usage.cache_creation_input_tokens??0,hour=Math.min(written,Number(usage.cache_creation?.ephemeral_1h_input_tokens??0));
 return((usage.input_tokens??0)*price[0]+(usage.output_tokens??0)*price[1]+(usage.cache_read_input_tokens??0)*price[0]*readMultiplier+(written-hour)*price[0]*1.25+hour*price[0]*2)/1e6+Number(usage.server_tool_use?.web_search_requests??0)*.01;
}
/** Total prompt tokens of a response, whether read from cache, written to it or uncached. */
export const promptTokens=(usage:any)=>(usage?.input_tokens??0)+(usage?.cache_read_input_tokens??0)+(usage?.cache_creation_input_tokens??0);
