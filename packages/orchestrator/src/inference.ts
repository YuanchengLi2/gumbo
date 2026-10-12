import {RunStream} from './run-stream';
import {assertToolExchanges} from './tool-exchanges';
import {budgetRequest} from './context-budget';
import {readMessageStream} from '../../../supabase/functions/_shared/stream';
import {providerSession,accountScope,type ProviderConnection} from './provider-session';
import {engineBudgets,usageCost,promptTokens} from '@dream/config';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {ProjectDB} from '@dream/project-db';

export class InferenceError extends Error {thinkingOnly?:boolean;constructor(message:string,public code:string,public httpStatus?:number){super(message);this.name='InferenceError';}}
export type InferenceResponse={content:any[];stop_reason:string;usage:unknown};
type Receipt={id:string;resume:number;attempt:number;capacity?:number;transientRetries?:number;usageRecorded?:boolean;status:'prepared'|'inflight'|'complete'|'failed'|'uncertain'|'truncated';response?:InferenceResponse;error?:string;retryable?:boolean;retryAfterMs?:number;providerRequestId?:string;diagnostics?:unknown;errorCode?:string};
// cacheTtl and taskBudget are optional gateway features; a gateway that does not know them ignores them.
type Input={model:string;system:string;messages:unknown[];tools:unknown[];turnId?:string;tool_choice?:unknown;purpose:string;max_tokens:number;profile?:unknown;phase?:string;cacheTtl?:'1h';taskBudget?:{total:number;remaining?:number}};
type Dependencies={fetch?:typeof fetch;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>;idleMs?:number};

const MAX_OUTPUT=engineBudgets.maxOutput,TRANSIENT_RETRIES=3,IDLE_MS=90_000,HARD_MS=20*60_000,HAIKU_HARD=engineBudgets.haikuHardInput;
// Execution-side purposes hand a still-truncated response back to the agent; others report a split request.
const AGENT_PURPOSES=['execution','worker','planning','answering'];
// Worker phases are named <agent phase>:worker:<call>:<task>; their activity nests under that task's row.
// A retried worker (phase suffix :r2) keeps its task's row.
const workerParent=(phase?:string)=>phase?.includes(':worker:')?'worker:'+phase.split(':worker:').at(-1)!.replace(/:r\d+$/,''):undefined;
function validResponse(value:any):value is InferenceResponse {
 const ids=Array.isArray(value?.content)?value.content.filter((b:any)=>b?.type==='tool_use').map((b:any)=>b.id):[];
 return value&&Array.isArray(value.content)&&new Set(ids).size===ids.length&&typeof value.stop_reason==='string'&&value.content.every((block:any)=>
  block&&typeof block.type==='string'&&(block.type!=='text'||typeof block.text==='string')&&
  (block.type!=='tool_use'||typeof block.id==='string'&&!!block.id&&typeof block.name==='string'&&!!block.name&&block.input&&typeof block.input==='object'));
}
/** After a server-side refusal fallback, blocks before the last fallback marker belong to the declined attempt.
 * Only its text continues; its tool calls never execute and its thinking is not echoed back (provider echo rules). */
export function servedContent(content:any[]){const boundary=content.findLastIndex(block=>block?.type==='fallback');return boundary<0?content:[...content.slice(0,boundary).filter(block=>block?.type==='text'),...content.slice(boundary+1)];}
/** Shortens the largest tool results after the last compaction boundary until the request fits. Deterministic, so
 * repeated requests stay byte-identical; the full results stay in local history and can be re-read in smaller ranges. */
function shrinkResults(messages:any[],excessBytes:number){
 // Messages here are per-request copies, but their content arrays are shared with saved history: replace, never mutate.
 const candidates:{message:any;index:number;size:number}[]=[];
 for(const message of messages)if(message.role==='user'&&Array.isArray(message.content))message.content.forEach((block:any,index:number)=>{if(block.type==='tool_result'&&typeof block.content==='string'&&block.content.length>6000)candidates.push({message,index,size:block.content.length});});
 candidates.sort((a,b)=>b.size-a.size);let saved=0;
 for(const {message,index,size} of candidates){if(saved>=excessBytes)break;const block=message.content[index],content=JSON.stringify({partial:true,totalCharacters:size,excerpt:block.content.slice(0,6000),note:'Shortened to keep this request within its context budget. Re-read a smaller range if you need the rest.'});message.content=message.content.map((b:any,n:number)=>n===index?{...b,content}:b);saved+=size-content.length;}
 return saved;
}
const visibleOutput=(response:any)=>Array.isArray(response?.content)&&response.content.some((b:any)=>b.type==='tool_use'||b.type==='text'&&String(b.text??'').trim());
const served=(body:any)=>body&&Array.isArray(body.content)?{...body,content:servedContent(body.content)}:body;
const failure=(body:any,status:number)=>typeof body?.error==='string'?body.error:typeof body?.error?.message==='string'?body.error.message:`AI request failed (${status}).`;
const transientStatus=(status:number)=>[408,429,500,502,503,504,529].includes(status);

/** Local response receipt closes the crash gap between inference and each caller's checkpoint. */
export async function infer(options:{db:ProjectDB;config:ProviderConnection;input:Input;resume:number;signal?:AbortSignal;connect?:()=>Promise<ProviderConnection>;publish?:(type:string,payload:unknown)=>void},dependencies:Dependencies={}):Promise<InferenceResponse>{
 const {db,input,resume,signal,publish}=options;let config=options.config;
 assertToolExchanges(input.messages as any[]);
 // The raised allowance after a cut-off belongs to one conversation phase, never to parallel workers or later steps.
 const capacityKey=`output_capacity:${input.turnId??'standalone'}:${input.model}:${input.phase??'main'}`,initialCapacity=Math.min(MAX_OUTPUT,Math.max(input.max_tokens,Number(db.getMeta(capacityKey)??input.max_tokens)));
 const request=dependencies.fetch??fetch,wait=dependencies.wait??(async(ms:number,signal?:AbortSignal)=>{await delay(ms,undefined,{signal});});
 const budgetInput={...input,max_tokens:initialCapacity} as any;
 // Build the provider view. The sticky view is reused; compaction runs only after a measured overrun.
 let budget=budgetRequest(db,budgetInput),session=providerSession(db,config,{...input,messages:budget.messages}),wireInput={...input,max_tokens:initialCapacity,messages:session.messages};
 // The last response's real prompt size calibrates the byte estimate, so most requests need no separate token count.
 const scopeName=`${input.purpose}:${input.model}:${input.phase??'main'}`,actualKey=`ctx-actual:${input.turnId??'standalone'}:${scopeName}`,haiku=input.model.startsWith('claude-haiku');
 // The estimate errs high; a ratio far outside the usual band means the usage report does not describe this prompt, so it is ignored.
 const calibration=(()=>{try{const value=JSON.parse(db.getMeta(actualKey)||'null') as {tokens:number;estimated:number}|null;return value&&value.estimated>0&&value.tokens/value.estimated>=.25&&value.tokens/value.estimated<=1.5?value:null;}catch{return null;}})();
 const calibrated=(estimated:number)=>calibration&&calibration.estimated>0?Math.round(calibration.tokens*estimated/calibration.estimated):undefined;
 const needsCount=()=>{const c=calibrated(budget.estimated);return c===undefined?budget.needsCount:c>budget.target*.95;};
 const fingerprintOf=(wire:any)=>createHash('sha256').update(JSON.stringify({url:config.url,account:session.account,epoch:session.epoch,input:wire})).digest('hex');
 let fingerprint=fingerprintOf(wireInput),key='inference:'+fingerprint;
 const saved=db.loadState<Receipt>(key);
 const tooLarge=()=>new InferenceError('The current instructions and fresh evidence exceed the provider context window even after archiving completed work. Reduce the active evidence size.','context_window');
 const measure=async()=>{
  const countKey='token-count:'+fingerprint,known=Number(db.getMeta(countKey)??0);if(known)return known;
  // A calibrated estimate clearly on one side of the target is trusted; only near-threshold requests are counted.
  const c=calibrated(budget.estimated);if(c!==undefined&&Math.abs(c-budget.target)>budget.target*.05)return c;
  signal?.throwIfAborted();const {phase:_phase,...wire}=wireInput as any;
  // Counting is advisory: when it is unavailable (rate limit, network), the conservative estimate decides instead.
  const response=await request(config.url+'/count-tokens',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},body:JSON.stringify(wire),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)}).catch(error=>{signal?.throwIfAborted();return error as Error;});
  const result=response instanceof Response?await response.json().catch(()=>({})) as any:{};
  if(!(response instanceof Response)||!response.ok||!Number.isFinite(result.input_tokens)){db.event('ai.count_fallback',{turnId:input.turnId,status:response instanceof Response?response.status:'network',estimated:budget.estimated});return budget.estimated;}
  db.setMeta(countKey,String(result.input_tokens));return result.input_tokens as number;
 };
 // The estimate is deliberately conservative, so it only decides whether to measure; compaction needs a real overrun.
 if(!saved?.response&&needsCount())for(let pass=0;;pass++){
  const count=await measure();if(count<=budget.target)break;
  if(pass>=2){if(count>budget.limit)throw tooLarge();break;}
  // Compact to half the target, so the following steps append to a stable, cached prefix instead of compacting again.
  const before=JSON.stringify(budget.messages).length;budget=budgetRequest(db,budgetInput,Math.max(.2,budget.target/count*.5));
  if(JSON.stringify(budget.messages).length>=before){if(count>budget.limit)throw tooLarge();break;}
  assertToolExchanges(budget.messages);session=providerSession(db,config,{...input,messages:budget.messages});wireInput={...input,max_tokens:initialCapacity,messages:session.messages};fingerprint=fingerprintOf(wireInput);key='inference:'+fingerprint;
 }
 // Haiku is never sent more than its hard input ceiling, which keeps it out of the long-context price tier.
 if(haiku&&!saved?.response){const total=calibrated(budget.estimated)??budget.estimated;if(total>HAIKU_HARD){const ratio=Buffer.byteLength(JSON.stringify(budget.messages))/Math.max(1,total);if(shrinkResults(budget.messages,Math.ceil((total-HAIKU_HARD*.9)*ratio))>0){session=providerSession(db,config,{...input,messages:budget.messages});wireInput={...input,max_tokens:initialCapacity,messages:session.messages};fingerprint=fingerprintOf(wireInput);key='inference:'+fingerprint;}}}
 // After compaction the provider can no longer derive the task budget already spent, so the remainder is sent explicitly.
 const spendKey=`task-spend:${input.turnId??'standalone'}:${scopeName}`;
 if(input.taskBudget&&JSON.stringify(budget.messages).includes('Older tool exchanges were compacted.')){const remaining=Math.max(0,input.taskBudget.total-Number(db.getMeta(spendKey)??0));wireInput={...wireInput,taskBudget:{total:input.taskBudget.total,remaining}};fingerprint=fingerprintOf(wireInput);key='inference:'+fingerprint;}
 assertToolExchanges(wireInput.messages);
 let receipt:Receipt=db.loadState<Receipt>(key)??{id:randomUUID(),resume,attempt:0,capacity:initialCapacity,transientRetries:0,status:'prepared'};
 const cancelRemote=async(id=receipt.id)=>{if(signal?.reason?.dreamStop==='shutdown')return;await request(config.url+'/ai-cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify({requestId:id}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
 const recover=async()=>{try{
  publish?.('ai.step',{id:'reconnect:'+receipt.id,label:'Reconnecting to AI',status:'running'});
  for(let n=0;n<65;n++){
   signal?.throwIfAborted();let response:Response;
   try{response=await request(config.url+'/ai-status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify({requestId:receipt.id}),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)])});}catch{signal?.throwIfAborted();return;}
   let body:any;try{body=await response.json();}catch{return;}
   if(response.ok&&validResponse(body)){publish?.('ai.step',{id:'reconnect:'+receipt.id,label:'Reconnecting to AI',status:'complete'});return body;}
   if(response.status!==202){publish?.('ai.step',{id:'reconnect:'+receipt.id,label:'Reconnecting to AI',status:'paused'});return;}
   await wait(2000,signal);
  }
  return;
 }finally{if(signal?.aborted)await cancelRemote();}};
 // An unconfirmed request from an earlier process: reclaim its response, otherwise cancel it and generate again.
 // Inference has no side effects; tools only execute after a complete response is saved.
 if(receipt.status==='inflight'||receipt.status==='uncertain'){
  const recovered=served(await recover());
  if(recovered){receipt.response=recovered;receipt.status=recovered.stop_reason==='max_tokens'?'truncated':'complete';db.saveState(key,receipt);}
  else{await cancelRemote();receipt={id:randomUUID(),resume,attempt:receipt.attempt+1,capacity:receipt.capacity,transientRetries:receipt.transientRetries??0,status:'prepared'};db.saveState(key,receipt);}
 }
 let started=Date.now();
 // One usage record per provider response: tokens, cost, duration and which phase and worker made the call.
 const recordUsage=(response:any)=>{
  const usage=response?.usage??{},costUsd=Number((typeof response?.dream_request?.costUsd==='number'?response.dream_request.costUsd:usageCost(input.model,usage)).toFixed(6));
  const event={turnId:input.turnId,requestId:receipt.id,model:input.model,purpose:input.purpose,phase:input.phase??'main',parent:workerParent(input.phase),pricingVersion:'anthropic-2026-10-07',usage,providerRequestId:receipt.providerRequestId,stopReason:response?.stop_reason,costUsd,durationMs:Date.now()-started,outputTokens:usage.output_tokens??0,visibleChars:JSON.stringify((response?.content??[]).filter((b:any)=>b?.type!=='thinking')).length};
  db.event('ai.usage',event);db.recordUsage?.(event);publish?.('ai.usage',event);
  db.setMeta(spendKey,String(Number(db.getMeta(spendKey)??0)+(usage.output_tokens??0)));
  if(promptTokens(usage)>0)db.setMeta(actualKey,JSON.stringify({tokens:promptTokens(usage),estimated:budget.estimated}));
  if(Array.isArray(response?.dream_policy?.features))db.setMeta('gateway_features',JSON.stringify(response.dream_policy.features));
 };
 if(receipt.status==='complete'&&receipt.response){if(input.turnId&&input.purpose!=='routing')new RunStream(db,input.turnId,receipt.id,publish,AGENT_PURPOSES.includes(input.purpose),workerParent(input.phase)).finish(receipt.response);session.record(receipt.response.content);if(!receipt.usageRecorded){receipt.usageRecorded=true;recordUsage(receipt.response);db.saveState(key,receipt);}return receipt.response;}
 signal?.throwIfAborted();
 const prefixHash=createHash('sha256').update(JSON.stringify({model:input.model,system:input.system,tools:input.tools,profile:input.profile})).digest('hex'),prefixKey='cache-prefix:'+input.turnId+':'+input.model+':'+(input.phase??'main');const previousPrefix=db.getMeta(prefixKey);if(previousPrefix!==prefixHash){db.setMeta(prefixKey,prefixHash);db.event('ai.cache_prefix',{turnId:input.turnId,model:input.model,prefixHash,changed:!!previousPrefix,reason:'Prompt, capability set, or intelligence profile changed; actual reuse is reported by provider usage.'});}
 const metricsKey='inference-context:'+fingerprint;
 if(!db.getMeta(metricsKey)){const metrics={turnId:input.turnId,model:input.model,profile:input.profile,estimatedInputTokens:budget.estimated,inputBudget:budget.limit,outputReserve:budget.outputReserve,systemCharacters:input.system.length,toolCharacters:JSON.stringify(input.tools).length,messageCharacters:JSON.stringify(wireInput.messages).length,toolCount:input.tools.length};db.db.transaction(()=>{db.setMeta(metricsKey,JSON.stringify(metrics));db.event('ai.context',metrics);})();}
 if(!config.token)throw new Error('Dream AI is disconnected. Retry when online. Local editing and export remain available offline.');
 if(receipt.resume!==resume&&receipt.status!=='prepared')receipt={id:randomUUID(),resume,attempt:0,capacity:initialCapacity,transientRetries:0,status:'prepared'};
 receipt.capacity??=input.max_tokens;receipt.transientRetries??=0;
 const save=()=>db.db.transaction(()=>{db.saveState(key,receipt);db.saveState('inference-attempt:'+receipt.id,receipt);})();
 const usage=()=>{if(!receipt.usageRecorded&&receipt.response){receipt.usageRecorded=true;recordUsage(receipt.response);}};
 const retryLater=async(reason:string,retryAfterMs?:number)=>{
  if(receipt.transientRetries!>=TRANSIENT_RETRIES)throw new InferenceError(reason+' Saved work is intact; resume to try again.','unavailable');
  const backoff=Math.max(500,Math.min(30_000,retryAfterMs??1000*2**receipt.transientRetries!));
  publish?.('ai.step',{label:'Reconnecting to AI',status:'running',detail:'Retrying a temporary service failure'});
  await wait(backoff,signal);signal?.throwIfAborted();receipt={id:randomUUID(),resume,attempt:receipt.attempt+1,capacity:receipt.capacity,transientRetries:receipt.transientRetries!+1,status:'prepared'};save();
 };

 for(;;){
  if(receipt.status==='truncated'){
   // A response that spent its whole allowance thinking is not retried with more room: the agent is told to act with less deliberation instead.
   if(AGENT_PURPOSES.includes(input.purpose)&&!visibleOutput(receipt.response))throw Object.assign(new InferenceError('The response used its whole allowance thinking before acting.','truncated'),{thinkingOnly:true});
   // A cut-off with visible content may double the allowance once for agents; creative definitions may grow to the maximum.
   if(receipt.capacity!>=MAX_OUTPUT||AGENT_PURPOSES.includes(input.purpose)&&receipt.capacity!>=input.max_tokens*2){
    if(AGENT_PURPOSES.includes(input.purpose))throw new InferenceError('Provider response reached max_tokens. Request a smaller complete unit.','truncated');
    throw new Error('This creative definition exceeds one response. Split it into reusable parts; completed changes are saved.');
   }
   receipt={id:randomUUID(),resume,attempt:receipt.attempt+1,capacity:Math.min(MAX_OUTPUT,receipt.capacity!*2),transientRetries:receipt.transientRetries,status:'prepared'};db.setMeta(capacityKey,String(receipt.capacity));save();
   publish?.('ai.step',{label:'Continuing with more room',status:'running',detail:'The response was longer than the current allowance'});
  }
  if(receipt.status==='failed'){
   if(!receipt.retryable)throw new InferenceError(receipt.error??'The AI request failed. Resume to try again.','provider');
   await retryLater(receipt.error??'The AI service is temporarily unavailable.',receipt.retryAfterMs);
  }
  started=Date.now();signal?.throwIfAborted();if(receipt.attempt>0&&options.connect){const renewed=await options.connect();if(renewed.url!==config.url||accountScope(renewed)!==accountScope(config))throw new Error('The AI connection changed. Resume to use the new account configuration.');config=renewed;}signal?.throwIfAborted();receipt.status='inflight';save();
  let response:Response,body:any;
  const live=input.turnId&&input.purpose!=='routing'?new RunStream(db,input.turnId,receipt.id,publish,AGENT_PURPOSES.includes(input.purpose),workerParent(input.phase)):undefined;
  // Idle watchdog instead of a total timeout: long generations are fine while events keep arriving (the gateway pings every 5s).
  const idle=new AbortController();let providerRequestId:string|undefined,timer:ReturnType<typeof setTimeout>|undefined;const touch=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>idle.abort(Object.assign(new Error('The AI stream stopped sending data.'),{code:'idle_timeout'})),dependencies.idleMs??IDLE_MS);};
  try{
   touch();
   const {phase:_phase,...wire}=wireInput as any;
   response=await request(`${config.url}/ai`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},body:JSON.stringify({...wire,requestId:receipt.id,stream:true,max_tokens:receipt.capacity}),signal:AbortSignal.any([...(signal?[signal]:[]),idle.signal,AbortSignal.timeout(HARD_MS)])});
   touch();
   body=response.ok&&response.headers.get('content-type')?.includes('text/event-stream')?await readMessageStream(response,event=>{touch();if(event.event==='dream_request')providerRequestId=event.data?.providerRequestId;live?.accept(event);}):await response.json();
  }catch(error){
   // Every failed attempt is recorded with what the stream showed, so a failure can be diagnosed after the run.
   if(!signal?.aborted)db.event('ai.inference_failed',{turnId:input.turnId,phase:input.phase??'main',purpose:input.purpose,model:input.model,attempt:receipt.attempt,transientRetries:receipt.transientRetries??0,code:(error as any).code??(error as Error).name,message:String((error as Error).message).slice(0,500),diagnostics:(error as any).diagnostics,providerRequestId:(error as any).diagnostics?.providerRequestId??providerRequestId});
   live?.interrupt((error as Error).message);receipt.status='uncertain';receipt.error=(error as Error).message;receipt.diagnostics=(error as any).diagnostics;receipt.errorCode=(error as any).code;save();
   if(signal?.aborted){await cancelRemote();signal.throwIfAborted();}
   const recovered=await recover();
   if(recovered){body=recovered;response=Response.json(body);}
   else{
    // The original attempt is abandoned: cancel it server-side so it cannot keep billing, then retry.
    await cancelRemote();const invalid=error instanceof SyntaxError||(error as any).code==='invalid_stream';
    receipt.status='failed';receipt.retryable=true;save();
    await retryLater(invalid?'The AI response could not be decoded. No incomplete edits were executed.':(error as Error).message);continue;
   }
  }finally{if(timer)clearTimeout(timer);}
  if(response.status===202){const recovered=await recover();if(recovered){body=recovered;response=Response.json(body);}else{await cancelRemote();receipt.status='failed';receipt.retryable=true;save();await retryLater('The AI response is still unconfirmed.');continue;}}
  signal?.throwIfAborted();
  body=served(body);
  receipt.providerRequestId=body?.dream_request?.providerRequestId;
  if(!response.ok){
   receipt.error=failure(body,response.status);
   if(['D0003','budget_exceeded','spend_limit'].includes(body?.error?.type)){receipt.status='failed';receipt.retryable=false;save();throw new InferenceError(receipt.error!,'quota',response.status);}
   if(body?.error?.type==='D0002'){receipt.status='failed';receipt.retryable=false;save();throw new InferenceError(receipt.error!,'request_conflict',response.status);}
   if([401,403].includes(response.status)){receipt.status='failed';receipt.retryable=false;save();throw new InferenceError(receipt.error!,'authentication',response.status);}
   const confirmedRetry=body?.dream_request?.status==='failed'&&body?.dream_request?.retryable===true,unconfirmed=body?.dream_request?.status!=='failed'&&transientStatus(response.status);
   receipt.status='failed';receipt.retryable=confirmedRetry||unconfirmed;receipt.retryAfterMs=body?.dream_request?.retryAfterMs;save();
   if(unconfirmed)await cancelRemote();
   continue;
  }
  if(body?.stop_reason==='max_tokens'){
   live?.finish(body);live?.interrupt('Response reached max_tokens; incomplete calls were not executed.');
   receipt.diagnostics=body.dream_truncation;
   db.db.transaction(()=>{receipt.status='truncated';receipt.response=body;usage();save();})();continue;
  }
  if(!validResponse(body)){
   receipt.status='failed';receipt.retryable=true;receipt.error='The AI service returned an incomplete response. No tools from it were executed.';save();continue;
  }
  db.db.transaction(()=>{receipt.status='complete';receipt.response=body;session.record(body.content);usage();save();})();live?.finish(body);
  if((receipt.capacity??input.max_tokens)>input.max_tokens){publish?.('ai.step',{label:'Continuing with more room',status:'complete'});db.setMeta(capacityKey,'');}
  if((receipt.transientRetries??0)>0)publish?.('ai.step',{label:'Reconnecting to AI',status:'complete',detail:'Connection restored'});
  return receipt.response!;
 }
}
