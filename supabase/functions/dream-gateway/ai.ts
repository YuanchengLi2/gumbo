import {requestStatus,type RequestStore} from './inference-requests.ts';
import {streamProvider} from './streaming.ts';
import {readMessageStream} from '../_shared/stream.ts';
import {providerModels,providerRates,providerSecrets,providerNames,providerEndpoints,deepseekMessagesEndpoint,chatRequest,responsesRequest,messagesRequest,anthropicStream,anthropicMessages,type ProviderId,type ProviderModel} from './providers.ts';
import {inferencePolicy,cachedPrompt,usageCost,validProfile,validTaskBudget,providerHeaders,pricingVersion,promptEstimate,refusalFallback,gatewayFeatures,FALLBACK_BETA,TASK_BUDGET_BETA} from './inference-policy.ts';

// Disabled for this instance if the provider rejects requests carrying fallbacks while accepting them without it.
let fallbackAccepted=true;
// Same pattern for task budgets: a provider that rejects them turns them off for this instance.
let taskBudgetAccepted=true;
export const resetFallbackSupport=()=>{fallbackAccepted=true;taskBudgetAccepted=true;};

const prices:Record<string,[number,number]>={'claude-haiku-5-5':[.1,.5],'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-haiku-4-5-20251001':[1,5],...Object.fromEntries(Object.entries(providerModels).map(([id,m])=>[id,m.price]))};
/** deepseekRoute: 'messages' sends DeepSeek requests to its Messages endpoint (the gateway's DEEPSEEK_ROUTE); otherwise chat. */
type Dependencies={db:any;key:string|undefined;providerKeys?:Partial<Record<ProviderId,string>>;fetcher?:typeof fetch;timeoutMs?:number;requests?:RequestStore;deepseekRoute?:string};
export async function handleAI(body:any,userId:string,{db,key,providerKeys={},fetcher=fetch,timeoutMs=350_000,requests,deepseekRoute}:Dependencies):Promise<{status:number;body:any;stream?:ReadableStream<Uint8Array>;finished?:Promise<void>}>{
 const failed=(message:string,status:number,code:string)=>({status,body:{error:{message,type:code},dream_request:{status:'failed',retryable:false}}});
 if(!validProfile(body.profile))return failed('Invalid intelligence profile',400,'invalid_request');
 if(!validTaskBudget(body.taskBudget)||body.cacheTtl!==undefined&&body.cacheTtl!=='1h')return failed('Invalid task budget or cache setting',400,'invalid_request');
 const other=providerModels[body.model];
 if(other&&!providerKeys[other.provider])return failed(`${providerNames[other.provider]} models need an API key on the gateway (${providerSecrets[other.provider]}).`,503,'provider_not_configured');
 if(!other&&!key)return failed('AI service is not configured',503,'configuration_error');
 if(!prices[body.model]||!Array.isArray(body.messages)||typeof body.requestId!=='string'||!body.requestId.length||body.requestId.length>200)return failed('Invalid AI request',400,'invalid_request');
 const encoded=JSON.stringify(body);if(encoded.length>12_000_000)return failed('Request too large',413,'request_too_large');
 const requested=Number(body.max_tokens??4096);if(!Number.isFinite(requested))return failed('Invalid output limit',400,'invalid_request');
 const maxTokens=Math.min(64000,Math.max(128,Math.floor(requested)));
 if(requests){try{const claimed=await requests.claim(body,userId,timeoutMs);if(!claimed.owner)return requestStatus(await requests.read(userId,body.requestId));}catch(error){return failed((error as Error).message,409,'request_conflict');}}
 const estimatedInput=promptEstimate({system:body.system,messages:body.messages,tools:body.tools}),reservationPrice=other?providerRates(other,{input_tokens:estimatedInput}).price:body.model==='claude-haiku-5-5'&&estimatedInput>100000?[.5,2.5]:prices[body.model];
 const estimate=(estimatedInput*reservationPrice[0]+maxTokens*reservationPrice[1])/1e6;
 const {data:usageId,error:limit}=await db.rpc('dream_reserve_usage',{p_user:userId,p_request:body.requestId,p_turn:body.turnId??body.requestId,p_model:body.model,p_reserved:estimate});
 if(limit){const result=failed(limit.message,limit.code==='D0001'?403:limit.code==='D0002'?409:limit.code==='D0003'?429:limit.code==='D0004'?402:503,limit.code==='D0004'?'credits_exhausted':limit.code??'reservation_error');await requests?.finish(userId,body.requestId,'failed',result.body,limit.message);return result;}
 let response:Response;const abort=new AbortController();
 if(other)return handleProvider(body,userId,{db,usageId,maxTokens,abort,fetcher,timeoutMs,requests,key:providerKeys[other.provider]!,api:other.provider==='deepseek'&&deepseekRoute==='messages'?'messages':other.api});
 const policyFor=(budget:boolean)=>inferencePolicy(body.model,body.purpose,body.profile,budget?{taskBudget:body.taskBudget}:{});
 const send=(fallback:boolean,budget:boolean)=>fetcher('https://api.anthropic.com/v1/messages',{method:'POST',headers:providerHeaders(key!,[...(fallback?[FALLBACK_BETA]:[]),...(budget?[TASK_BUDGET_BETA]:[])]),body:JSON.stringify({model:body.model,max_tokens:maxTokens,messages:anthropicMessages(body.messages),...cachedPrompt(body.system,body.tools,body.cacheTtl),...policyFor(budget),tool_choice:body.tool_choice,stream:body.stream===true,...(fallback?{fallbacks:'default'}:{})}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(timeoutMs)])});
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

/** A request for another provider's model: translated, sent, and its stream translated back into Anthropic events, then
 * streamed and accounted exactly like a Claude request. A non-streaming request reads the translated stream to the end. */
async function handleProvider(body:any,userId:string,o:{db:any;usageId:string;maxTokens:number;abort:AbortController;fetcher:typeof fetch;timeoutMs:number;requests?:RequestStore;key:string;api:ProviderModel['api']}){
 const prepare=(api:ProviderModel['api'])=>{const model={...providerModels[body.model],api},messages=api==='messages';
  return{model,request:api==='responses'?responsesRequest(body,model,o.maxTokens,userId):messages?messagesRequest(body,model,o.maxTokens):chatRequest(body,model,o.maxTokens),
   endpoint:messages?deepseekMessagesEndpoint:providerEndpoints[model.provider],headers:(messages?{'Content-Type':'application/json','x-api-key':o.key,'anthropic-version':'2023-06-01'}:{'Content-Type':'application/json',Authorization:`Bearer ${o.key}`}) as Record<string,string>};};
 let {model,request,endpoint,headers}=prepare(o.api),response:Response,fellBack=false;
 const send=()=>o.fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.any([o.abort.signal,AbortSignal.timeout(o.timeoutMs)])});
 try{
  response=await send();
  // A request DeepSeek's Messages endpoint refuses (400 or 422: not processed, not billed) is answered on the chat route,
  // which takes every conversation Gumbo sends; the log keeps why, so the Messages form can be fixed.
  if(model.api==='messages'&&(response.status===400||response.status===422)){
   console.warn(`DeepSeek Messages refused a request (${response.status}), answered on the chat route: ${(await response.text().catch(()=>'')).slice(0,500)}`);
   ({model,request,endpoint,headers}=prepare('chat'));fellBack=true;response=await send();
  }
 }
 catch{
  await o.requests?.finish(userId,body.requestId,'uncertain',undefined,'The provider connection ended before confirming the response.');await o.db.from('dream_usage').update({status:'uncertain',error_code:'connection_ended'}).eq('id',o.usageId);
  return{status:503,body:{error:{message:'The provider connection ended before its outcome was received.',type:'connection_ended'},dream_request:{status:'uncertain',retryable:false}}};
 }
 // The receipt names the cache key the call was sent with, so the app's records show which gateway answered: a key per
 // user and prompt start ('gumbo-<user>-<prompt>') shares the cache across requests; a request id does not.
 // DeepSeek's receipts say which route answered, for comparing the two on real edits.
 const route=model.provider==='deepseek'?['deepseek-route:'+(fellBack?'chat-fallback':model.api)]:[];
 const policy={pricingVersion,thinkingDisplay:'omitted',maxTokens:o.maxTokens,features:['cost-receipts',...route,...((request as any).prompt_cache_key?['prompt-cache-key:'+(request as any).prompt_cache_key]:[])]};
 if(!response.ok){
  const body_=await response.json().catch(()=>({})) as any,detail=Array.isArray(body_)?body_[0]:body_,message=detail?.error?.message?`${providerNames[model.provider]} refused the request (${response.status}): ${String(detail.error.message).slice(0,300)}`:`${providerNames[model.provider]} returned ${response.status}.`,retryable=[429,500,502,503,504].includes(response.status);
  await o.db.from('dream_usage').update({status:'failed',provider_status:response.status,error_code:detail?.error?.type??detail?.error?.code??'provider_error'}).eq('id',o.usageId);
  const answer={status:response.status,body:{error:{message,type:detail?.error?.type??'provider_error'},dream_policy:policy,dream_request:{status:'failed',retryable,retryAfterMs:retryable?2000:undefined}}};
  await o.requests?.finish(userId,body.requestId,'failed',answer.body,message);return answer;
 }
 const translated=anthropicStream(response,model,body.model,body.requestId);
 if(body.stream===true)return{status:200,body:null,...streamProvider(translated,{db:o.db,usageId:o.usageId,model:body.model,price:model.price,abort:o.abort,requests:o.requests,userId,maxTokens:o.maxTokens,requestId:body.requestId,effectivePolicy:{},features:policy.features})};
 let message:any;
 try{message=await readMessageStream(translated);}
 catch(error){await o.db.from('dream_usage').update({status:'uncertain',error_code:'invalid_provider_response'}).eq('id',o.usageId);const body_={error:{message:(error as Error).message,type:'invalid_provider_response'},dream_request:{status:'uncertain',retryable:false}};await o.requests?.finish(userId,body.requestId,'uncertain',undefined,(error as Error).message);return{status:502,body:body_};}
 const usage=message.usage??{},cost=usageCost(body.model,usage,model.price),{error:accountingError}=await o.db.from('dream_usage').update({status:'completed',input_tokens:usage.input_tokens??0,output_tokens:usage.output_tokens??0,cache_read_tokens:usage.cache_read_input_tokens??0,cache_write_tokens:0,cost_usd:cost,provider_status:200}).eq('id',o.usageId);
 const answer={status:200,body:{...message,dream_policy:policy,dream_request:{status:'completed',retryable:false,accountingPending:!!accountingError,effectivePolicy:{},costUsd:cost}}};
 await o.requests?.finish(userId,body.requestId,'completed',answer.body);return answer;
}
