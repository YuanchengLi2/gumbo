import {requestStatus,type RequestStore} from './inference-requests.ts';
import {streamProvider} from './streaming.ts';
import {inferencePolicy,cachedPrompt,usageCost,validProfile,validTaskBudget,providerHeaders,pricingVersion,promptEstimate,refusalFallback,gatewayFeatures,FALLBACK_BETA,TASK_BUDGET_BETA} from './inference-policy.ts';

// Disabled for this instance if the provider rejects requests carrying fallbacks while accepting them without it.
let fallbackAccepted=true;
// Same pattern for task budgets: a provider that rejects them turns them off for this instance.
let taskBudgetAccepted=true;
export const resetFallbackSupport=()=>{fallbackAccepted=true;taskBudgetAccepted=true;};

const prices:Record<string,[number,number]>={'claude-haiku-5-5':[.1,.5],'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-haiku-4-5-20251001':[1,5]};
type Dependencies={db:any;key:string|undefined;fetcher?:typeof fetch;timeoutMs?:number;requests?:RequestStore};
export async function handleAI(body:any,userId:string,{db,key,fetcher=fetch,timeoutMs=350_000,requests}:Dependencies):Promise<{status:number;body:any;stream?:ReadableStream<Uint8Array>;finished?:Promise<void>}>{
 const failed=(message:string,status:number,code:string)=>({status,body:{error:{message,type:code},dream_request:{status:'failed',retryable:false}}});
 if(!validProfile(body.profile))return failed('Invalid intelligence profile',400,'invalid_request');
 if(!validTaskBudget(body.taskBudget)||body.cacheTtl!==undefined&&body.cacheTtl!=='1h')return failed('Invalid task budget or cache setting',400,'invalid_request');
 if(!key)return failed('AI service is not configured',503,'configuration_error');
 if(!prices[body.model]||!Array.isArray(body.messages)||typeof body.requestId!=='string'||!body.requestId.length||body.requestId.length>200)return failed('Invalid AI request',400,'invalid_request');
 const encoded=JSON.stringify(body);if(encoded.length>12_000_000)return failed('Request too large',413,'request_too_large');
 const requested=Number(body.max_tokens??4096);if(!Number.isFinite(requested))return failed('Invalid output limit',400,'invalid_request');
 const maxTokens=Math.min(64000,Math.max(128,Math.floor(requested)));
 if(requests){try{const claimed=await requests.claim(body,userId,timeoutMs);if(!claimed.owner)return requestStatus(await requests.read(userId,body.requestId));}catch(error){return failed((error as Error).message,409,'request_conflict');}}
 const estimatedInput=promptEstimate({system:body.system,messages:body.messages,tools:body.tools}),reservationPrice=body.model==='claude-haiku-5-5'&&estimatedInput>100000?[.5,2.5]:prices[body.model];
 const estimate=(estimatedInput*reservationPrice[0]+maxTokens*reservationPrice[1])/1e6;
 const {data:usageId,error:limit}=await db.rpc('dream_reserve_usage',{p_user:userId,p_request:body.requestId,p_turn:body.turnId??body.requestId,p_model:body.model,p_reserved:estimate});
 if(limit){const result=failed(limit.message,limit.code==='D0001'?403:limit.code==='D0002'?409:limit.code==='D0003'?429:503,limit.code??'reservation_error');await requests?.finish(userId,body.requestId,'failed',result.body,limit.message);return result;}
 let response:Response;const abort=new AbortController();
 const policyFor=(budget:boolean)=>inferencePolicy(body.model,body.purpose,body.profile,budget?{taskBudget:body.taskBudget}:{});
 const send=(fallback:boolean,budget:boolean)=>fetcher('https://api.anthropic.com/v1/messages',{method:'POST',headers:providerHeaders(key,[...(fallback?[FALLBACK_BETA]:[]),...(budget?[TASK_BUDGET_BETA]:[])]),body:JSON.stringify({model:body.model,max_tokens:maxTokens,messages:body.messages,...cachedPrompt(body.system,body.tools,body.cacheTtl),...policyFor(budget),tool_choice:body.tool_choice,stream:body.stream===true,...(fallback?{fallbacks:'default'}:{})}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(timeoutMs)])});
 let withFallback=fallbackAccepted&&refusalFallback(body.model),withBudget=taskBudgetAccepted&&!!body.taskBudget;
 try{
  response=await send(withFallback,withBudget);
  // A rejected request is not processed or billed: retry without the optional feature, and stop sending it if that succeeds.
  if(withBudget&&response.status===400){const retry=await send(withFallback,false);if(retry.status!==400){taskBudgetAccepted=false;console.warn('Task budgets rejected by the provider; disabled for this instance.');}withBudget=false;response=retry;}
  if(withFallback&&response.status===400){const retry=await send(false,withBudget);if(retry.status!==400){fallbackAccepted=false;console.warn('Refusal fallback rejected by the provider; disabled for this instance.');}withFallback=false;response=retry;}
 }
 catch{
  await requests?.finish(userId,body.requestId,'uncertain',undefined,'The provider connection ended before confirming the response.');
  await db.from('dream_usage').update({status:'uncertain',error_code:'connection_ended'}).eq('id',usageId);
  return{status:503,body:{error:{message:'The provider connection ended before its outcome was received.',type:'connection_ended'},dream_request:{status:'uncertain',retryable:false}}};
 }
 if(response.ok&&body.stream===true&&response.headers.get('content-type')?.includes('text/event-stream'))return{status:200,body:null,...streamProvider(response,{db,usageId,model:body.model,price:prices[body.model],abort,requests,userId,maxTokens,requestId:body.requestId,effectivePolicy:policyFor(withBudget),features:gatewayFeatures(taskBudgetAccepted)})};
 const providerRequestId=response.headers.get('request-id')??undefined;let result:any;
 try{result=await response.json();}catch{
  if(response.ok){await requests?.finish(userId,body.requestId,'uncertain',undefined,'The provider response could not be decoded.');await db.from('dream_usage').update({status:'uncertain',error_code:'invalid_provider_response',provider_request_id:providerRequestId}).eq('id',usageId);return{status:502,body:{error:{message:'The provider response could not be decoded.',type:'invalid_provider_response'},dream_request:{status:'uncertain',retryable:false,providerRequestId}}};}
  result={error:{message:`AI provider returned ${response.status}.`,type:'provider_error'}};
 }
 const usage=result.usage??{},retryHeader=response.headers.get('retry-after'),retryNumber=Number(retryHeader),retrySeconds=retryHeader?(Number.isFinite(retryNumber)?retryNumber:Math.max(0,(Date.parse(retryHeader)-Date.now())/1000)):0;
 // Spend-cap 429 responses have no Retry-After and must not be retried automatically.
 const retryable=retrySeconds<=30&&([500,504,529].includes(response.status)||(response.status===429&&retrySeconds>0));
 const {error:accountingError}=await db.from('dream_usage').update({status:response.ok?'completed':'failed',input_tokens:usage.input_tokens??0,output_tokens:usage.output_tokens??0,cache_read_tokens:usage.cache_read_input_tokens??0,cache_write_tokens:usage.cache_creation_input_tokens??0,cost_usd:usageCost(body.model,usage,prices[body.model]),provider_request_id:providerRequestId,provider_status:response.status,error_code:result.error?.type??null}).eq('id',usageId);
 const answer={status:response.status,body:{...result,dream_policy:{pricingVersion,thinkingDisplay:policyFor(withBudget).thinking?.display??'omitted',maxTokens,features:gatewayFeatures(taskBudgetAccepted)},dream_request:{status:response.ok?'completed':'failed',retryable,retryAfterMs:retrySeconds>0?Math.ceil(retrySeconds*1000):undefined,providerRequestId,accountingPending:!!accountingError,effectivePolicy:policyFor(withBudget),costUsd:usageCost(body.model,usage,prices[body.model])}}};
 await requests?.finish(userId,body.requestId,response.ok?'completed':'failed',answer.body,result.error?.message);return answer;
}
